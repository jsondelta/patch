const std = @import("std");
const json = std.json;
const Writer = std.io.Writer;

const ally = std.heap.wasm_allocator;

var result_data: ?[]u8 = null;

export fn alloc(len: usize) ?[*]u8 {
    const slice = ally.alloc(u8, len) catch return null;
    return slice.ptr;
}

export fn dealloc(ptr: [*]u8, len: usize) void {
    ally.free(ptr[0..len]);
}

export fn getResultPtr() ?[*]const u8 {
    if (result_data) |d| return d.ptr;
    return null;
}

export fn getResultLen() usize {
    if (result_data) |d| return d.len;
    return 0;
}

export fn freeResult() void {
    if (result_data) |d| {
        ally.free(d);
        result_data = null;
    }
}

export fn patch(doc_ptr: [*]const u8, doc_len: usize, delta_ptr: [*]const u8, delta_len: usize) i32 {
    const doc_slice = doc_ptr[0..doc_len];
    const delta_slice = delta_ptr[0..delta_len];

    const doc_parsed = json.parseFromSlice(json.Value, ally, doc_slice, .{}) catch return -1;
    defer doc_parsed.deinit();

    const delta_parsed = json.parseFromSlice(json.Value, ally, delta_slice, .{}) catch return -1;
    defer delta_parsed.deinit();

    const ops = delta_parsed.value.array.items;
    const doc = applyOps(doc_parsed.value, ops) catch return -1;

    var aw: Writer.Allocating = .init(ally);
    errdefer aw.deinit();

    var jw: json.Stringify = .{ .writer = &aw.writer };
    jw.write(doc) catch return -1;
    aw.writer.flush() catch return -1;
    const slice = aw.toOwnedSlice() catch return -1;
    result_data = slice;
    return @intCast(slice.len);
}

export fn invert(delta_ptr: [*]const u8, delta_len: usize) i32 {
    const delta_slice = delta_ptr[0..delta_len];

    const delta_parsed = json.parseFromSlice(json.Value, ally, delta_slice, .{}) catch return -1;
    defer delta_parsed.deinit();

    const ops = delta_parsed.value.array.items;

    var aw: Writer.Allocating = .init(ally);
    errdefer aw.deinit();

    var jw: json.Stringify = .{ .writer = &aw.writer };
    jw.beginArray() catch return -1;

    var i: usize = ops.len;
    while (i > 0) {
        i -= 1;
        const obj = ops[i].object;
        const op_str = obj.get("op").?.string;
        const path_val = obj.get("path").?;

        if (std.mem.eql(u8, op_str, "add")) {
            jw.beginObject() catch return -1;
            jw.objectField("op") catch return -1;
            jw.write("remove") catch return -1;
            jw.objectField("path") catch return -1;
            jw.write(path_val) catch return -1;
            jw.objectField("value") catch return -1;
            jw.write(obj.get("value").?) catch return -1;
            jw.endObject() catch return -1;
        } else if (std.mem.eql(u8, op_str, "remove")) {
            jw.beginObject() catch return -1;
            jw.objectField("op") catch return -1;
            jw.write("add") catch return -1;
            jw.objectField("path") catch return -1;
            jw.write(path_val) catch return -1;
            jw.objectField("value") catch return -1;
            jw.write(obj.get("value").?) catch return -1;
            jw.endObject() catch return -1;
        } else if (std.mem.eql(u8, op_str, "replace")) {
            jw.beginObject() catch return -1;
            jw.objectField("op") catch return -1;
            jw.write("replace") catch return -1;
            jw.objectField("path") catch return -1;
            jw.write(path_val) catch return -1;
            jw.objectField("old") catch return -1;
            jw.write(obj.get("new").?) catch return -1;
            jw.objectField("new") catch return -1;
            jw.write(obj.get("old").?) catch return -1;
            jw.endObject() catch return -1;
        }
    }

    jw.endArray() catch return -1;
    aw.writer.flush() catch return -1;
    const slice = aw.toOwnedSlice() catch return -1;
    result_data = slice;
    return @intCast(slice.len);
}

const PatchError = error{OutOfMemory};

fn applyOps(doc: json.Value, ops: []const json.Value) PatchError!json.Value {
    if (ops.len == 0) return deepClone(doc);

    // check for root-level ops (path.length == 0)
    var last_root_op: ?json.Value = null;
    for (ops) |op_val| {
        const obj = op_val.object;
        const path = obj.get("path").?.array.items;
        if (path.len == 0) last_root_op = op_val;
    }

    if (last_root_op) |root_op| {
        const obj = root_op.object;
        const op_str = obj.get("op").?.string;
        if (std.mem.eql(u8, op_str, "replace")) return deepClone(obj.get("new").?);
        if (std.mem.eql(u8, op_str, "add")) return deepClone(obj.get("value").?);
        if (std.mem.eql(u8, op_str, "remove")) return .null;
    }

    switch (doc) {
        .array => |arr| return rebuildArray(arr, ops),
        .object => |obj| return rebuildObject(obj, ops),
        else => return deepClone(doc),
    }
}

fn getFirstSegmentIndex(op_val: json.Value) ?i64 {
    const obj = op_val.object;
    const path = obj.get("path").?.array.items;
    if (path.len == 0) return null;
    return path[0].integer;
}

fn getFirstSegmentKey(op_val: json.Value) ?[]const u8 {
    const obj = op_val.object;
    const path = obj.get("path").?.array.items;
    if (path.len == 0) return null;
    return path[0].string;
}

fn subOps(op_val: json.Value) json.Value {
    // return op with path shifted by one segment
    const obj = op_val.object;
    const path = obj.get("path").?.array;
    const rest_items = path.items[1..];

    var new_path = json.Array.init(ally);
    new_path.ensureTotalCapacity(rest_items.len) catch unreachable;
    for (rest_items) |item| {
        new_path.appendAssumeCapacity(item);
    }

    var new_obj = json.ObjectMap.init(ally);
    new_obj.ensureTotalCapacity(@intCast(obj.count())) catch unreachable;
    var it = obj.iterator();
    while (it.next()) |entry| {
        const key = ally.dupe(u8, entry.key_ptr.*) catch unreachable;
        if (std.mem.eql(u8, entry.key_ptr.*, "path")) {
            new_obj.putAssumeCapacity(key, .{ .array = new_path });
        } else {
            new_obj.putAssumeCapacity(key, entry.value_ptr.*);
        }
    }

    return .{ .object = new_obj };
}

fn rebuildArray(arr: json.Array, ops: []const json.Value) PatchError!json.Value {
    // collect removes and adds at this level
    var removes = std.AutoHashMap(usize, void).init(ally);
    defer removes.deinit();

    const AddEntry = struct { idx: usize, value: json.Value };
    var adds_list: std.ArrayList(AddEntry) = .{};
    defer adds_list.deinit(ally);

    const SubOp = struct { idx: usize, op: json.Value };
    var sub_ops_list: std.ArrayList(SubOp) = .{};
    defer sub_ops_list.deinit(ally);

    for (ops) |op_val| {
        const idx_opt = getFirstSegmentIndex(op_val);
        if (idx_opt == null) continue;
        const idx: usize = @intCast(idx_opt.?);
        const sub = subOps(op_val);
        const sub_obj = sub.object;
        const sub_path = sub_obj.get("path").?.array.items;
        const sub_op_str = sub_obj.get("op").?.string;

        if (sub_path.len == 0 and std.mem.eql(u8, sub_op_str, "remove")) {
            try removes.put(idx, {});
        } else if (sub_path.len == 0 and std.mem.eql(u8, sub_op_str, "add") and idx >= arr.items.len) {
            try adds_list.append(ally, .{ .idx = idx, .value = sub_obj.get("value").? });
        } else {
            try sub_ops_list.append(ally, .{ .idx = idx, .op = sub });
        }
    }

    var result = json.Array.init(ally);

    for (arr.items, 0..) |item, i| {
        if (removes.contains(i)) continue;

        // collect ops for this index
        var child_ops_list: std.ArrayList(json.Value) = .{};
        defer child_ops_list.deinit(ally);
        for (sub_ops_list.items) |entry| {
            if (entry.idx == i) try child_ops_list.append(ally, entry.op);
        }

        if (child_ops_list.items.len > 0) {
            try result.append(try applyOps(item, child_ops_list.items));
        } else {
            try result.append(try deepClone(item));
        }
    }

    // sort adds by index and append
    std.mem.sort(AddEntry, adds_list.items, {}, struct {
        fn lessThan(_: void, a: AddEntry, b: AddEntry) bool {
            return a.idx < b.idx;
        }
    }.lessThan);

    for (adds_list.items) |entry| {
        try result.append(try deepClone(entry.value));
    }

    return .{ .array = result };
}

fn rebuildObject(obj: json.ObjectMap, ops: []const json.Value) PatchError!json.Value {
    var removes = std.StringHashMap(void).init(ally);
    defer removes.deinit();

    const AddEntry = struct { key: []const u8, value: json.Value };
    var adds_list: std.ArrayList(AddEntry) = .{};
    defer adds_list.deinit(ally);

    const SubOp = struct { key: []const u8, op: json.Value };
    var sub_ops_list: std.ArrayList(SubOp) = .{};
    defer sub_ops_list.deinit(ally);

    for (ops) |op_val| {
        const key_opt = getFirstSegmentKey(op_val);
        if (key_opt == null) continue;
        const key = key_opt.?;
        const sub = subOps(op_val);
        const sub_obj = sub.object;
        const sub_path = sub_obj.get("path").?.array.items;
        const sub_op_str = sub_obj.get("op").?.string;

        if (sub_path.len == 0 and std.mem.eql(u8, sub_op_str, "remove")) {
            try removes.put(key, {});
        } else if (sub_path.len == 0 and std.mem.eql(u8, sub_op_str, "add") and !obj.contains(key)) {
            try adds_list.append(ally, .{ .key = key, .value = sub_obj.get("value").? });
        } else {
            try sub_ops_list.append(ally, .{ .key = key, .op = sub });
        }
    }

    var new_obj = json.ObjectMap.init(ally);

    var it = obj.iterator();
    while (it.next()) |entry| {
        if (removes.contains(entry.key_ptr.*)) continue;

        var child_ops_list: std.ArrayList(json.Value) = .{};
        defer child_ops_list.deinit(ally);
        for (sub_ops_list.items) |sub_entry| {
            if (std.mem.eql(u8, sub_entry.key, entry.key_ptr.*)) {
                try child_ops_list.append(ally, sub_entry.op);
            }
        }

        const k = try ally.dupe(u8, entry.key_ptr.*);
        if (child_ops_list.items.len > 0) {
            try new_obj.put(k, try applyOps(entry.value_ptr.*, child_ops_list.items));
        } else {
            try new_obj.put(k, try deepClone(entry.value_ptr.*));
        }
    }

    for (adds_list.items) |entry| {
        const k = try ally.dupe(u8, entry.key);
        try new_obj.put(k, try deepClone(entry.value));
    }

    return .{ .object = new_obj };
}

fn deepClone(val: json.Value) PatchError!json.Value {
    return switch (val) {
        .null, .bool, .integer, .float => val,
        .string => |s| .{ .string = try ally.dupe(u8, s) },
        .number_string => |s| .{ .number_string = try ally.dupe(u8, s) },
        .array => |arr| {
            var new_arr = json.Array.init(ally);
            try new_arr.ensureTotalCapacity(arr.items.len);
            for (arr.items) |item| {
                new_arr.appendAssumeCapacity(try deepClone(item));
            }
            return .{ .array = new_arr };
        },
        .object => |obj| {
            var new_obj = json.ObjectMap.init(ally);
            try new_obj.ensureTotalCapacity(@intCast(obj.count()));
            var it = obj.iterator();
            while (it.next()) |entry| {
                const key = try ally.dupe(u8, entry.key_ptr.*);
                new_obj.putAssumeCapacity(key, try deepClone(entry.value_ptr.*));
            }
            return .{ .object = new_obj };
        },
    };
}
