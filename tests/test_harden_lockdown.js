"use strict";

function throw_error(msg) {
    throw Error(msg);
}

function assert(actual, expected, message) {
    if (arguments.length == 1)
        expected = true;

    if (typeof actual === typeof expected) {
        if (actual === expected) {
            if (actual !== 0 || (1 / actual) === (1 / expected))
                return;
        }
        if (typeof actual === 'number') {
            if (isNaN(actual) && isNaN(expected))
                return;
        }
        if (typeof actual === 'object') {
            if (actual !== null && expected !== null
            &&  actual.constructor === expected.constructor
            &&  actual.toString() === expected.toString())
                return;
        }
    }
    throw_error("assertion failed: got |" + actual + "|, expected |" + expected + "|" +
                (message ? " (" + message + ")" : ""));
}

function assert_throws(expected_error, func) {
    var err = false;
    try {
        func();
    } catch(e) {
        err = true;
        if (!(e instanceof expected_error)) {
            throw_error("unexpected exception type: " + e.constructor.name + " instead of " + expected_error.name);
        }
    }
    if (!err) {
        throw_error("expected exception " + expected_error.name);
    }
}

// ============================================================
// PHASE 1: PREREQUISITE TESTS
// Object.preventExtensions, Object.seal, Object.freeze
// and their corresponding Object.is* methods
// ============================================================

// ============================================================
// Test 1: Object.preventExtensions / Object.isExtensible
// ============================================================

function test_preventExtensions() {
    // 1.1 Object.preventExtensions exists
    assert(typeof Object.preventExtensions, "function", "preventExtensions exists");

    // 1.2 Object.isExtensible exists
    assert(typeof Object.isExtensible, "function", "isExtensible exists");

    // 1.3 New objects are extensible by default
    var obj = { x: 1 };
    assert(Object.isExtensible(obj), true, "new object is extensible");

    // 1.4 preventExtensions returns the object
    var result = Object.preventExtensions(obj);
    assert(result === obj, true, "preventExtensions returns same object");

    // 1.5 After preventExtensions, object is not extensible
    assert(Object.isExtensible(obj), false, "object is not extensible after preventExtensions");

    // 1.6 Cannot add new properties to non-extensible object
    assert_throws(TypeError, function() {
        obj.newProp = 123;
    });

    // 1.7 Existing properties can still be modified
    obj.x = 100;
    assert(obj.x, 100, "existing property can be modified");

    // 1.8 Existing properties can still be deleted
    delete obj.x;
    assert(obj.x, undefined, "existing property can be deleted");

    // 1.9 preventExtensions on primitives returns the primitive
    assert(Object.preventExtensions(42), 42, "preventExtensions on number");
    assert(Object.preventExtensions("str"), "str", "preventExtensions on string");
    assert(Object.preventExtensions(true), true, "preventExtensions on boolean");
    assert(Object.preventExtensions(null), null, "preventExtensions on null");
    assert(Object.preventExtensions(undefined), undefined, "preventExtensions on undefined");

    // 1.10 isExtensible on primitives returns false
    assert(Object.isExtensible(42), false, "isExtensible on number");
    assert(Object.isExtensible("str"), false, "isExtensible on string");
    assert(Object.isExtensible(null), false, "isExtensible on null");
}

// ============================================================
// Test 2: Object.seal / Object.isSealed
// ============================================================

function test_seal() {
    // 2.1 Object.seal exists
    assert(typeof Object.seal, "function", "seal exists");

    // 2.2 Object.isSealed exists
    assert(typeof Object.isSealed, "function", "isSealed exists");

    // 2.3 New objects are not sealed
    var obj = { x: 1, y: 2 };
    assert(Object.isSealed(obj), false, "new object is not sealed");

    // 2.4 seal returns the object
    var result = Object.seal(obj);
    assert(result === obj, true, "seal returns same object");

    // 2.5 After seal, object is sealed
    assert(Object.isSealed(obj), true, "object is sealed after seal");

    // 2.6 Sealed object is also non-extensible
    assert(Object.isExtensible(obj), false, "sealed object is not extensible");

    // 2.7 Cannot add new properties to sealed object
    assert_throws(TypeError, function() {
        obj.newProp = 123;
    });

    // 2.8 Cannot delete properties from sealed object
    assert_throws(TypeError, function() {
        delete obj.x;
    });

    // 2.9 Can still modify existing properties (not frozen)
    obj.x = 100;
    assert(obj.x, 100, "can modify existing property on sealed object");

    // 2.10 seal on primitives returns the primitive
    assert(Object.seal(42), 42, "seal on number");
    assert(Object.seal("str"), "str", "seal on string");

    // 2.11 isSealed on primitives returns true (vacuously sealed)
    assert(Object.isSealed(42), true, "isSealed on number");
    assert(Object.isSealed("str"), true, "isSealed on string");
    assert(Object.isSealed(null), true, "isSealed on null");

    // 2.12 Empty non-extensible object is sealed
    var empty = {};
    Object.preventExtensions(empty);
    assert(Object.isSealed(empty), true, "empty non-extensible object is sealed");
}

// ============================================================
// Test 3: Object.freeze / Object.isFrozen
// ============================================================

function test_freeze() {
    // 3.1 Object.freeze exists
    assert(typeof Object.freeze, "function", "freeze exists");

    // 3.2 Object.isFrozen exists
    assert(typeof Object.isFrozen, "function", "isFrozen exists");

    // 3.3 New objects are not frozen
    var obj = { x: 1, y: 2 };
    assert(Object.isFrozen(obj), false, "new object is not frozen");

    // 3.4 freeze returns the object
    var result = Object.freeze(obj);
    assert(result === obj, true, "freeze returns same object");

    // 3.5 After freeze, object is frozen
    assert(Object.isFrozen(obj), true, "object is frozen after freeze");

    // 3.6 Frozen object is also sealed and non-extensible
    assert(Object.isSealed(obj), true, "frozen object is sealed");
    assert(Object.isExtensible(obj), false, "frozen object is not extensible");

    // 3.7 Cannot add new properties to frozen object
    assert_throws(TypeError, function() {
        obj.newProp = 123;
    });

    // 3.8 Cannot delete properties from frozen object
    assert_throws(TypeError, function() {
        delete obj.x;
    });

    // 3.9 Cannot modify existing properties on frozen object
    assert_throws(TypeError, function() {
        obj.x = 100;
    });

    // 3.10 Property value is preserved
    assert(obj.x, 1, "frozen property value preserved");

    // 3.11 freeze on primitives returns the primitive
    assert(Object.freeze(42), 42, "freeze on number");
    assert(Object.freeze("str"), "str", "freeze on string");
    assert(Object.freeze(null), null, "freeze on null");

    // 3.12 isFrozen on primitives returns true (vacuously frozen)
    assert(Object.isFrozen(42), true, "isFrozen on number");
    assert(Object.isFrozen("str"), true, "isFrozen on string");
    assert(Object.isFrozen(null), true, "isFrozen on null");

    // 3.13 Empty non-extensible object is frozen
    var empty = {};
    Object.preventExtensions(empty);
    assert(Object.isFrozen(empty), true, "empty non-extensible object is frozen");
}

// ============================================================
// Test 4: Object.freeze with nested objects (shallow freeze)
// ============================================================

function test_freeze_shallow() {
    // 4.1 freeze is shallow - nested objects are not frozen
    var obj = {
        x: 1,
        nested: { y: 2 }
    };
    Object.freeze(obj);

    assert(Object.isFrozen(obj), true, "outer object is frozen");
    assert(Object.isFrozen(obj.nested), false, "nested object is NOT frozen");

    // 4.2 Can still modify nested object
    obj.nested.y = 200;
    assert(obj.nested.y, 200, "nested property can be modified");

    // 4.3 Can add to nested object
    obj.nested.z = 300;
    assert(obj.nested.z, 300, "can add to nested object");
}

// ============================================================
// Test 5: Object.freeze with arrays
// ============================================================

function test_freeze_arrays() {
    // 5.1 Can freeze arrays
    var arr = [1, 2, 3];
    Object.freeze(arr);
    assert(Object.isFrozen(arr), true, "array is frozen");

    // 5.2 Cannot modify array elements
    assert_throws(TypeError, function() {
        arr[0] = 100;
    });

    // 5.3 Cannot push to frozen array
    assert_throws(TypeError, function() {
        arr.push(4);
    });

    // 5.4 Cannot pop from frozen array
    assert_throws(TypeError, function() {
        arr.pop();
    });

    // 5.5 Array values are preserved
    assert(arr[0], 1, "array element preserved");
    assert(arr.length, 3, "array length preserved");
}

// ============================================================
// Test 6: Object.freeze with functions
// ============================================================

function test_freeze_functions() {
    // 6.1 Can freeze functions
    var fn = function() { return 42; };
    fn.customProp = "hello";
    Object.freeze(fn);

    assert(Object.isFrozen(fn), true, "function is frozen");

    // 6.2 Function still works
    assert(fn(), 42, "frozen function still callable");

    // 6.3 Cannot modify function properties
    assert_throws(TypeError, function() {
        fn.customProp = "world";
    });

    // 6.4 Cannot add properties to frozen function
    assert_throws(TypeError, function() {
        fn.newProp = 123;
    });
}

// ============================================================
// PHASE 2: HARDEN TESTS
// ============================================================

// ============================================================
// Test 7: harden() basic functionality
// ============================================================

function test_harden_basic() {
    // 7.1 harden function exists
    assert(typeof harden, "function", "harden exists");

    // 7.2 harden returns the same object
    var obj = { x: 1 };
    var result = harden(obj);
    assert(result === obj, true, "harden returns same object");

    // 7.3 harden makes object frozen
    assert(Object.isFrozen(obj), true, "hardened object is frozen");

    // 7.4 harden handles primitives (pass-through)
    assert(harden(42), 42, "harden number");
    assert(harden("hello"), "hello", "harden string");
    assert(harden(true), true, "harden boolean");
    assert(harden(null), null, "harden null");
    assert(harden(undefined), undefined, "harden undefined");

    // 7.5 harden is idempotent (calling twice is safe)
    var obj2 = { a: 1 };
    harden(obj2);
    harden(obj2);  // Should not throw
    assert(Object.isFrozen(obj2), true, "double harden still frozen");
}

// ============================================================
// Test 8: harden() transitive freezing
// ============================================================

function test_harden_transitive() {
    // 8.1 harden freezes nested objects
    var obj = {
        x: 1,
        nested: {
            y: 2,
            deep: {
                z: 3
            }
        }
    };
    harden(obj);

    assert(Object.isFrozen(obj), true, "outer object frozen");
    assert(Object.isFrozen(obj.nested), true, "nested object frozen");
    assert(Object.isFrozen(obj.nested.deep), true, "deeply nested object frozen");

    // 8.2 Cannot modify any level
    assert_throws(TypeError, function() {
        obj.x = 100;
    });
    assert_throws(TypeError, function() {
        obj.nested.y = 200;
    });
    assert_throws(TypeError, function() {
        obj.nested.deep.z = 300;
    });
}

// ============================================================
// Test 9: harden() freezes prototype chain
// ============================================================

function test_harden_prototype() {
    // 9.1 harden freezes custom prototype
    var proto = { shared: "value" };
    var obj = Object.create(proto);
    obj.own = "property";

    harden(obj);

    assert(Object.isFrozen(obj), true, "object frozen");
    assert(Object.isFrozen(proto), true, "prototype frozen");

    // 9.2 Cannot modify prototype
    assert_throws(TypeError, function() {
        proto.shared = "modified";
    });

    // 9.3 Cannot add to prototype
    assert_throws(TypeError, function() {
        proto.newProp = "new";
    });
}

// ============================================================
// Test 10: harden() handles circular references
// ============================================================

function test_harden_circular() {
    // 10.1 harden handles simple circular reference
    var a = { name: "a" };
    var b = { name: "b", ref: a };
    a.ref = b;

    harden(a);  // Should not infinite loop

    assert(Object.isFrozen(a), true, "a is frozen");
    assert(Object.isFrozen(b), true, "b is frozen");
    assert(Object.isFrozen(a.ref), true, "a.ref is frozen");
    assert(Object.isFrozen(b.ref), true, "b.ref is frozen");

    // 10.2 harden handles self-reference
    var self = { name: "self" };
    self.self = self;

    harden(self);

    assert(Object.isFrozen(self), true, "self-referential object frozen");
}

// ============================================================
// Test 11: harden() freezes array elements
// ============================================================

function test_harden_arrays() {
    // 11.1 harden freezes array and its object elements
    var arr = [
        { a: 1 },
        { b: 2 },
        [3, 4, { c: 5 }]
    ];

    harden(arr);

    assert(Object.isFrozen(arr), true, "array is frozen");
    assert(Object.isFrozen(arr[0]), true, "array element 0 frozen");
    assert(Object.isFrozen(arr[1]), true, "array element 1 frozen");
    assert(Object.isFrozen(arr[2]), true, "nested array frozen");
    assert(Object.isFrozen(arr[2][2]), true, "nested array object frozen");

    // 11.2 Cannot modify any element
    assert_throws(TypeError, function() {
        arr[0].a = 100;
    });
}

// ============================================================
// Test 12: harden() freezes getter/setter functions
// ============================================================

function test_harden_accessors() {
    // 12.1 harden freezes accessor functions
    var getter = function() { return this._value; };
    var setter = function(v) { this._value = v; };

    var obj = {
        _value: 42
    };
    Object.defineProperty(obj, "value", {
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true
    });

    harden(obj);

    assert(Object.isFrozen(obj), true, "object with accessor is frozen");
    assert(Object.isFrozen(getter), true, "getter function is frozen");
    assert(Object.isFrozen(setter), true, "setter function is frozen");
}

// ============================================================
// PHASE 3: LOCKDOWN TESTS
// ============================================================

// ============================================================
// Test 13: lockdown() basic functionality
// ============================================================

function test_lockdown_basic() {
    // Use a compartment to test lockdown without affecting main realm
    var c = new Compartment();

    // 13.1 lockdown function exists
    assert(c.evaluate("typeof lockdown"), "function", "lockdown exists");

    // 13.2 lockdown returns undefined
    var result = c.evaluate("lockdown()");
    assert(result, undefined, "lockdown returns undefined");

    // 13.3 lockdown can only be called once
    assert_throws(TypeError, function() {
        c.evaluate("lockdown()");
    });
}

// ============================================================
// Test 14: lockdown() freezes intrinsics
// ============================================================

function test_lockdown_intrinsics() {
    // Note: lockdown() was already called in test_lockdown_basic
    // All compartments share intrinsics, so they're already frozen
    var c = new Compartment();

    // 14.1 Object.prototype is frozen
    assert(c.evaluate("Object.isFrozen(Object.prototype)"), true,
           "Object.prototype is frozen");

    // 14.2 Array.prototype is frozen
    assert(c.evaluate("Object.isFrozen(Array.prototype)"), true,
           "Array.prototype is frozen");

    // 14.3 Function.prototype is frozen
    assert(c.evaluate("Object.isFrozen(Function.prototype)"), true,
           "Function.prototype is frozen");

    // 14.4 String.prototype is frozen
    assert(c.evaluate("Object.isFrozen(String.prototype)"), true,
           "String.prototype is frozen");

    // 14.5 Number.prototype is frozen
    assert(c.evaluate("Object.isFrozen(Number.prototype)"), true,
           "Number.prototype is frozen");

    // 14.6 Object constructor is frozen
    assert(c.evaluate("Object.isFrozen(Object)"), true,
           "Object constructor is frozen");

    // 14.7 Array constructor is frozen
    assert(c.evaluate("Object.isFrozen(Array)"), true,
           "Array constructor is frozen");

    // 14.8 Error.prototype is frozen
    assert(c.evaluate("Object.isFrozen(Error.prototype)"), true,
           "Error.prototype is frozen");
}

// ============================================================
// Test 15: lockdown() prevents prototype pollution
// ============================================================

function test_lockdown_prevents_pollution() {
    // Note: lockdown() was already called in test_lockdown_basic
    var c = new Compartment();

    // 15.1 Cannot add properties to Object.prototype
    assert_throws(TypeError, function() {
        c.evaluate("Object.prototype.malicious = function() {}");
    });

    // 15.2 Cannot modify existing methods
    assert_throws(TypeError, function() {
        c.evaluate("Object.prototype.toString = function() { return 'hacked'; }");
    });

    // 15.3 Cannot modify Array.prototype.push
    assert_throws(TypeError, function() {
        c.evaluate("Array.prototype.push = function() {}");
    });

    // 15.4 Cannot delete from prototypes
    assert_throws(TypeError, function() {
        c.evaluate("delete Object.prototype.toString");
    });
}

// ============================================================
// Test 16: lockdown() does not break normal code
// ============================================================

function test_lockdown_normal_code_works() {
    // Note: lockdown() was already called in test_lockdown_basic
    var c = new Compartment();

    // 16.1 Can still create objects
    var obj = c.evaluate("({ x: 1, y: 2 })");
    assert(obj.x, 1, "can create objects");

    // 16.2 Can still create arrays
    var arr = c.evaluate("[1, 2, 3]");
    assert(arr.length, 3, "can create arrays");

    // 16.3 Can still define functions
    assert(c.evaluate("(function(a, b) { return a + b; })(2, 3)"), 5,
           "can define and call functions");

    // 16.4 Can still use built-in methods
    assert(c.evaluate("[1, 2, 3].map(function(x) { return x * 2; })").toString(),
           "2,4,6", "can use Array.map");

    // 16.5 User objects are still mutable
    c.evaluate("var userObj = { count: 0 }");
    c.evaluate("userObj.count++");
    assert(c.evaluate("userObj.count"), 1, "user objects are mutable");

    // 16.6 Can still use Object.keys
    assert(c.evaluate("Object.keys({ a: 1, b: 2 }).length"), 2,
           "Object.keys works");

    // 16.7 Errors still work
    var caught = c.evaluate("var e; try { throw new Error('test'); } catch(x) { e = x.message; } e");
    assert(caught, "test", "errors still work");
}

// ============================================================
// Test 17: lockdown() and Compartment interaction
// ============================================================

function test_lockdown_compartments() {
    // Note: lockdown() was already called in test_lockdown_basic
    // 17.1 Nested compartments see frozen intrinsics (shared)
    var parent = new Compartment();
    parent.evaluate("var child = new Compartment()");

    // Child sees frozen intrinsics (shared from context-wide lockdown)
    assert(parent.evaluate("child.evaluate('Object.isFrozen(Object.prototype)')"), true,
           "child sees frozen intrinsics after lockdown");

    // 17.2 New compartments created after lockdown see frozen intrinsics
    parent.evaluate("var child2 = new Compartment()");
    assert(parent.evaluate("child2.evaluate('Object.isFrozen(Array.prototype)')"), true,
           "new child sees frozen intrinsics");
}

// ============================================================
// Test 18: harden() works after lockdown()
// ============================================================

function test_harden_after_lockdown() {
    // Note: lockdown() was already called in test_lockdown_basic
    var c = new Compartment();

    // 18.1 Can harden user objects after lockdown
    c.evaluate("var obj = { x: 1, nested: { y: 2 } }");
    c.evaluate("harden(obj)");

    assert(c.evaluate("Object.isFrozen(obj)"), true, "user object hardened");
    assert(c.evaluate("Object.isFrozen(obj.nested)"), true, "nested object hardened");

    // 18.2 Hardened user objects reject modification
    assert_throws(TypeError, function() {
        c.evaluate("obj.x = 100");
    });
}

// ============================================================
// Test 19: Global lockdown (optional - tests main realm)
// ============================================================

// NOTE: This test modifies the main realm permanently!
// Only run this as the LAST test or in a separate test file

function test_global_lockdown() {
    // Skip if lockdown already called
    if (typeof lockdown !== "function") {
        print("  test_global_lockdown SKIPPED (lockdown not available globally)");
        return;
    }

    // 19.1 lockdown in main realm
    lockdown();

    // 19.2 Intrinsics are frozen
    assert(Object.isFrozen(Object.prototype), true, "Object.prototype frozen globally");
    assert(Object.isFrozen(Array.prototype), true, "Array.prototype frozen globally");

    // 19.3 Cannot pollute prototypes
    assert_throws(TypeError, function() {
        Object.prototype.hack = "bad";
    });

    // 19.4 Normal code still works
    var obj = { test: 123 };
    assert(obj.test, 123, "can still create objects");
}

// ============================================================
// Run All Tests
// ============================================================

// Phase 1: Prerequisites
test_preventExtensions();
print("  test_preventExtensions passed");

test_seal();
print("  test_seal passed");

test_freeze();
print("  test_freeze passed");

test_freeze_shallow();
print("  test_freeze_shallow passed");

test_freeze_arrays();
print("  test_freeze_arrays passed");

test_freeze_functions();
print("  test_freeze_functions passed");

// Phase 2: harden()
test_harden_basic();
print("  test_harden_basic passed");

test_harden_transitive();
print("  test_harden_transitive passed");

test_harden_prototype();
print("  test_harden_prototype passed");

test_harden_circular();
print("  test_harden_circular passed");

test_harden_arrays();
print("  test_harden_arrays passed");

test_harden_accessors();
print("  test_harden_accessors passed");

// Phase 3: lockdown()
test_lockdown_basic();
print("  test_lockdown_basic passed");

test_lockdown_intrinsics();
print("  test_lockdown_intrinsics passed");

test_lockdown_prevents_pollution();
print("  test_lockdown_prevents_pollution passed");

test_lockdown_normal_code_works();
print("  test_lockdown_normal_code_works passed");

test_lockdown_compartments();
print("  test_lockdown_compartments passed");

test_harden_after_lockdown();
print("  test_harden_after_lockdown passed");

// Phase 4: Global lockdown (run last - modifies main realm)
// Uncomment to test global lockdown:
// test_global_lockdown();
// print("  test_global_lockdown passed");

print("All harden/lockdown tests passed!");
