# Implementation Plan: harden() and lockdown() for MQuickJS

## Executive Summary

This plan implements `harden()` and `lockdown()` security primitives for MQuickJS using TDD. A key discovery is that **Object.freeze(), Object.preventExtensions(), and related methods are not yet implemented** - these are prerequisites.

## Scope (Confirmed)

| Feature | Status |
|---------|--------|
| `harden()` - transitive freeze | In scope |
| `lockdown()` - freeze all intrinsics | In scope |
| Error rollback on partial failure | In scope |
| Date.now / Math.random taming | Out of scope |
| Stamp prevention | Out of scope (no private fields) |
| petrify() / mutabilities() | Out of scope |
| Immutable ArrayBuffer | Out of scope |

---

## Phase 1: Prerequisites - Object Immutability Methods

### 1.1 Add Object Flags to JSObject Structure

**File**: `mquickjs.c` (struct JSObject, ~line 324)

Add a flags field to track object state:

```c
struct JSObject {
    JS_MB_HEADER;
    JSWord class_id: 8;
    JSWord obj_flags: 8;        // NEW: Object state flags
    JSWord extra_size: ...;     // Adjust bit allocation
    // ... rest of struct
};
```

**Flag definitions** (add to `mquickjs_priv.h`):

```c
#define JS_OBJ_FLAG_EXTENSIBLE   0x01  // Can add new properties (default ON)
#define JS_OBJ_FLAG_SEALED       0x02  // Cannot add/delete/reconfigure props
#define JS_OBJ_FLAG_FROZEN       0x04  // Sealed + all data props read-only
#define JS_OBJ_FLAG_HARDENED     0x08  // Transitively frozen (for harden())
```

### 1.2 Implement Object Static Methods

| Method | Behavior |
|--------|----------|
| `Object.preventExtensions(obj)` | Set !EXTENSIBLE flag, return obj |
| `Object.seal(obj)` | preventExtensions + mark SEALED |
| `Object.freeze(obj)` | seal + mark FROZEN |
| `Object.isExtensible(obj)` | Return !(obj_flags & !EXTENSIBLE) |
| `Object.isSealed(obj)` | Return obj_flags & SEALED |
| `Object.isFrozen(obj)` | Return obj_flags & FROZEN |

### 1.3 Enforce Flags in Property Operations

Modify these functions to check flags:

1. **`JS_DefinePropertyInternal()`** (~line 2960)
   - If !EXTENSIBLE and property doesn't exist → TypeError
   - If SEALED and trying to delete/reconfigure → TypeError
   - If FROZEN and trying to modify data property → TypeError

2. **`JS_SetPropertyInternal()`** (~line 3230)
   - If FROZEN and property is data property → TypeError

3. **`js_create_property()`** (~line 2868)
   - Check EXTENSIBLE flag before creating

---

## Phase 2: harden() Implementation

### 2.1 Algorithm

```
harden(root):
  1. If root is primitive, return root
  2. If root has HARDENED flag, return root (fast path)

  3. Create object queue, add root
  4. Create "processed" list for rollback

  5. While queue not empty:
       obj = dequeue()
       if obj has HARDENED flag, continue

       try:
         // Freeze the object
         Object.freeze(obj)

         // Queue prototype
         proto = Object.getPrototypeOf(obj)
         if proto is object and not hardened:
           enqueue(proto)

         // Queue all property values
         for each own property key:
           desc = getOwnPropertyDescriptor(obj, key)
           if desc.value is object: enqueue(desc.value)
           if desc.get is object: enqueue(desc.get)
           if desc.set is object: enqueue(desc.set)

         // Mark as hardened
         obj.flags |= HARDENED
         processed.push(obj)

       catch error:
         // Rollback: clear HARDENED flag from processed objects
         for each p in processed:
           p.flags &= ~HARDENED
         throw error

  6. Return root
```

### 2.2 C Implementation Location

Add to `mquickjs.c` near other Object methods (~line 13700):

```c
static JSValue js_harden(JSContext *ctx, JSValue this_val, int argc, JSValue *argv);
```

Register in `mqjs_stdlib.c` as global function.

---

## Phase 3: lockdown() Implementation

### 3.1 Algorithm

```
lockdown():
  1. If already locked down (global flag), throw TypeError

  2. Set global LOCKDOWN flag

  3. Harden all class prototypes:
     for i = 0 to ctx->class_count:
       harden(ctx->class_proto[i])

  4. Harden all class constructors:
     for i = 0 to ctx->class_count:
       harden(ctx->class_obj[i])

  5. Harden global object properties:
     harden(ctx->global_obj)

  6. Harden hidden intrinsics:
     - Iterator prototypes (accessed via symbols)
     - ThrowTypeError function

  7. Replace prototype.constructor properties with throwing function:
     Function.prototype.constructor = ThrowTypeError
     (This prevents `obj.constructor("malicious code")`)
```

### 3.2 Lockdown Flag Location

Add to `JSContext` structure:

```c
struct JSContext {
    // ... existing fields
    uint8_t locked_down;  // NEW: lockdown() has been called
};
```

### 3.3 C Implementation Location

Add to `mquickjs.c`:

```c
static JSValue js_lockdown(JSContext *ctx, JSValue this_val, int argc, JSValue *argv);
```

Register in `mqjs_stdlib.c` as global function.

---

## Phase 4: Test Plan (TDD)

### Test File: `tests/test_harden_lockdown.js`

#### Group 1: Object.freeze/preventExtensions Prerequisites
```
- Object.preventExtensions exists and works
- Object.isExtensible returns correct values
- Object.seal exists and works
- Object.isSealed returns correct values
- Object.freeze exists and works
- Object.isFrozen returns correct values
- Frozen object rejects property writes (TypeError)
- Frozen object rejects property additions (TypeError)
- Frozen object rejects property deletions (TypeError)
```

#### Group 2: harden() Basic Functionality
```
- harden() function exists
- harden() returns the same object
- harden() handles primitives (pass-through)
- harden() makes object frozen
- harden() is idempotent (calling twice is safe)
```

#### Group 3: harden() Transitive Freezing
```
- harden() freezes nested objects
- harden() freezes prototype chain
- harden() freezes getter/setter functions
- harden() handles circular references
- harden() freezes array elements
```

#### Group 4: harden() Error Handling
```
- harden() rolls back on failure (if possible to test)
- harden() throws on proxy that rejects freeze (if proxies supported)
```

#### Group 5: lockdown() Basic Functionality
```
- lockdown() function exists
- lockdown() returns undefined
- lockdown() can only be called once (second call throws TypeError)
```

#### Group 6: lockdown() Freezes Intrinsics
```
- Object.prototype is frozen after lockdown
- Array.prototype is frozen after lockdown
- Function.prototype is frozen after lockdown
- String.prototype is frozen after lockdown
- Object constructor is frozen after lockdown
- Cannot add properties to Object.prototype after lockdown
- Cannot modify Array.prototype.push after lockdown
```

#### Group 7: lockdown() Does Not Break Normal Code
```
- Can still create objects after lockdown
- Can still create arrays after lockdown
- Can still define functions after lockdown
- Can still use all built-in methods after lockdown
- User objects are still mutable after lockdown
```

#### Group 8: Compartment Integration
```
- Compartment intrinsics are shared (already frozen if parent locked down)
- New compartments see frozen intrinsics if created after lockdown
- harden() works inside compartments
```

---

## Implementation Order (TDD)

### Step 1: Write Prerequisite Tests
1. Write tests for Object.preventExtensions/isExtensible
2. Write tests for Object.seal/isSealed
3. Write tests for Object.freeze/isFrozen
4. Run tests → all fail (expected)

### Step 2: Implement Prerequisites
1. Add obj_flags to JSObject structure
2. Implement Object.preventExtensions/isExtensible
3. Run tests → some pass
4. Implement Object.seal/isSealed
5. Run tests → more pass
6. Implement Object.freeze/isFrozen
7. Enforce flags in property operations
8. Run tests → all prerequisite tests pass

### Step 3: Write harden() Tests
1. Write basic harden() tests
2. Write transitive freezing tests
3. Write error handling tests
4. Run tests → all fail (expected)

### Step 4: Implement harden()
1. Implement basic harden() with queue traversal
2. Run tests → basic tests pass
3. Add prototype traversal
4. Run tests → more pass
5. Add accessor traversal
6. Add rollback logic
7. Run tests → all harden tests pass

### Step 5: Write lockdown() Tests
1. Write basic lockdown() tests
2. Write intrinsic freezing tests
3. Write "does not break normal code" tests
4. Run tests → all fail (expected)

### Step 6: Implement lockdown()
1. Add locked_down flag to JSContext
2. Implement intrinsic iteration and hardening
3. Run tests → tests pass
4. Add constructor replacement (optional enhancement)

### Step 7: Integration & Regression Testing
1. Run `make test` for full test suite
2. Verify all existing tests still pass
3. Run compartment tests
4. Run benchmarks to check performance impact

---

## Files to Modify

| File | Changes |
|------|---------|
| `mquickjs_priv.h` | Add obj_flags constants |
| `mquickjs.c` | Add obj_flags to JSObject, implement freeze/harden/lockdown |
| `mqjs_stdlib.c` | Register new Object methods and global functions |
| `tests/test_harden_lockdown.js` | New test file |
| `Makefile` | Add new test to test target |

---

## Risk Mitigation

1. **Memory overhead**: obj_flags adds 1 byte per object - acceptable for embedded
2. **Performance**: Flag checks in hot paths - use inline checks, benchmark
3. **Compatibility**: Existing code expects mutable prototypes - lockdown is opt-in
4. **ROM properties**: Current ROM properties may need special handling

---

## Success Criteria

1. All new tests pass
2. All existing tests pass (no regressions)
3. `harden(obj)` transitively freezes object graph
4. `lockdown()` freezes all intrinsics
5. Normal user code works after lockdown
6. Compartment isolation still works
