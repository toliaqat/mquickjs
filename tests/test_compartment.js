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
// Test 1: Basic Compartment Creation
// ============================================================

function test_compartment_creation() {
    // 1.1 Compartment constructor exists
    assert(typeof Compartment, "function", "Compartment is a function");

    // 1.2 Create compartment with no options
    var c = new Compartment();
    assert(c instanceof Compartment, true, "c is Compartment instance");

    // 1.3 Create compartment with empty options
    var c2 = new Compartment({});
    assert(c2 instanceof Compartment, true, "c2 is Compartment instance");
}

// ============================================================
// Test 2: globalThis Isolation
// ============================================================

function test_globalThis_isolation() {
    var c = new Compartment();

    // 2.1 globalThis getter returns an object
    assert(typeof c.globalThis, "object", "globalThis is object");
    assert(c.globalThis !== null, true, "globalThis is not null");

    // 2.2 Compartment's globalThis is different from parent
    assert(c.globalThis !== globalThis, true, "different globalThis");

    // 2.3 Multiple accesses return same object
    assert(c.globalThis === c.globalThis, true, "same globalThis on repeated access");

    // 2.4 Two compartments have different globalThis
    var c2 = new Compartment();
    assert(c.globalThis !== c2.globalThis, true, "different compartments have different globalThis");
}

// ============================================================
// Test 3: evaluate() Basic Functionality
// ============================================================

function test_evaluate_basic() {
    var c = new Compartment();

    // 3.1 evaluate returns last expression value
    assert(c.evaluate("1 + 2"), 3, "evaluate arithmetic");

    // 3.2 evaluate returns undefined for var statements
    assert(c.evaluate("var x = 1;"), undefined, "var returns undefined");

    // 3.3 evaluate string literals
    assert(c.evaluate("'hello'"), "hello", "string literal");

    // 3.4 evaluate with empty string
    assert(c.evaluate(""), undefined, "empty string");

    // 3.5 evaluate complex expressions
    assert(c.evaluate("(function(a, b) { return a * b; })(6, 7)"), 42, "IIFE");
}

// ============================================================
// Test 4: globals Option
// ============================================================

function test_globals_option() {
    // 4.1 Pass globals in constructor
    var c = new Compartment({
        globals: {
            x: 42,
            greeting: "hello"
        }
    });

    assert(c.evaluate("x"), 42, "global x");
    assert(c.evaluate("greeting"), "hello", "global greeting");

    // 4.2 globals are writable by default
    c.evaluate("x = 100");
    assert(c.evaluate("x"), 100, "modified global x");

    // 4.3 globals are accessible on globalThis
    assert(c.globalThis.x, 100, "globalThis.x");

    // 4.4 globals with functions
    var called = false;
    var c2 = new Compartment({
        globals: {
            myFunc: function(a) { called = true; return a * 2; }
        }
    });
    assert(c2.evaluate("myFunc(21)"), 42, "function global");
    assert(called, true, "function was called");

    // 4.5 Empty globals object
    var c3 = new Compartment({ globals: {} });
    assert(c3.evaluate("1 + 1"), 2, "empty globals");
}

// ============================================================
// Test 5: globalLexicals Option
// Implemented via IIFE wrapping - code is wrapped in a function
// that receives lexicals as parameters.
// ============================================================

function test_globalLexicals_option() {
    // 5.1 globalLexicals provides lexical bindings
    var c = new Compartment({
        globalLexicals: {
            letVar: 10,
            constVar: 20
        }
    });

    assert(c.evaluate("letVar"), 10, "lexical letVar");
    assert(c.evaluate("constVar"), 20, "lexical constVar");

    // 5.2 lexicals are NOT on globalThis
    assert(c.evaluate("typeof globalThis.letVar"), "undefined", "lexical not on globalThis");

    // 5.3 lexicals shadow globals with same name
    var c2 = new Compartment({
        globals: { x: 1 },
        globalLexicals: { x: 2 }
    });
    assert(c2.evaluate("x"), 2, "lexical shadows global");
    assert(c2.globalThis.x, 1, "global x still on globalThis");

    // 5.4 lexicals with functions
    var callCount = 0;
    var c3 = new Compartment({
        globalLexicals: {
            callback: function() { callCount++; return 42; }
        }
    });
    assert(c3.evaluate("callback()"), 42, "lexical function callable");
    assert(callCount, 1, "lexical function was called");

    // 5.5 lexicals work with expressions
    var c4 = new Compartment({
        globalLexicals: { a: 5, b: 3 }
    });
    assert(c4.evaluate("a + b"), 8, "lexicals in expression");
    assert(c4.evaluate("a * b"), 15, "lexicals in multiplication");

    // 5.6 empty globalLexicals
    var c5 = new Compartment({ globalLexicals: {} });
    assert(c5.evaluate("1 + 1"), 2, "empty globalLexicals");
}

// ============================================================
// Test 6: Shared Intrinsics
// ============================================================

function test_shared_intrinsics() {
    var c = new Compartment();

    // 6.1 Array.prototype is shared
    assert(c.evaluate("Array.prototype") === Array.prototype, true, "Array.prototype shared");

    // 6.2 Object.prototype is shared
    assert(c.evaluate("Object.prototype") === Object.prototype, true, "Object.prototype shared");

    // 6.3 Function.prototype is shared
    assert(c.evaluate("Function.prototype") === Function.prototype, true, "Function.prototype shared");

    // 6.4 Error.prototype is shared
    assert(c.evaluate("Error.prototype") === Error.prototype, true, "Error.prototype shared");

    // 6.5 Arrays created in compartment are instanceof Array
    var arr = c.evaluate("[1, 2, 3]");
    assert(arr instanceof Array, true, "compartment array instanceof Array");

    // 6.6 Objects share prototype chain
    var obj = c.evaluate("({})");
    assert(Object.getPrototypeOf(obj) === Object.prototype, true, "object proto shared");
}

// ============================================================
// Test 7: Error Handling in evaluate()
// ============================================================

function test_error_handling() {
    var c = new Compartment();

    // 7.1 Syntax error throws
    assert_throws(SyntaxError, function() {
        c.evaluate("function {");
    });

    // 7.2 Runtime error throws
    assert_throws(ReferenceError, function() {
        c.evaluate("undefinedVar");
    });

    // 7.3 TypeError propagates
    assert_throws(TypeError, function() {
        c.evaluate("null.foo");
    });

    // 7.4 Thrown errors are catchable inside compartment
    var caught = c.evaluate("var r; try { throw Error('test'); } catch(e) { r = e.message; } r");
    assert(caught, "test", "error caught in compartment");

    // 7.5 Errors thrown in compartment propagate with correct type
    var thrownError = null;
    try {
        c.evaluate("throw new Error('compartment error')");
    } catch(e) {
        thrownError = e;
    }
    assert(thrownError instanceof Error, true, "error instanceof Error");
    assert(thrownError.message, "compartment error", "error message preserved");
}

// ============================================================
// Test 8: Nested Compartments
// ============================================================

function test_nested_compartments() {
    var c1 = new Compartment({
        globals: { x: 1 }
    });

    // 8.1 Compartment constructor is available in compartment
    assert(c1.evaluate("typeof Compartment"), "function", "Compartment available in compartment");

    // 8.2 Child compartment can be created from parent
    c1.evaluate("var child = new Compartment({ globals: { y: 2 } })");

    // 8.3 Child has own globalThis (different from parent)
    assert(c1.evaluate("child.globalThis !== globalThis"), true, "child has different globalThis");

    // 8.4 Parent globals not visible in child (attenuation)
    assert(c1.evaluate("child.evaluate('typeof x')"), "undefined", "parent global not in child");

    // 8.5 Child has its own globals
    assert(c1.evaluate("child.evaluate('y')"), 2, "child has own global");

    // 8.6 Deep nesting works (3 levels)
    var deepResult = c1.evaluate("var c2 = new Compartment({ globals: { z: 3 } }); c2.evaluate('var c3 = new Compartment({ globals: { w: 4 } }); c3.evaluate(\"w\")')");
    assert(deepResult, 4, "3-level deep nesting works");
}

// ============================================================
// Test 9: State Persistence in Compartment
// ============================================================

function test_state_persistence() {
    var c = new Compartment();

    // 9.1 Variable persists between evaluate calls
    c.evaluate("var count = 0");
    c.evaluate("count++");
    c.evaluate("count++");
    assert(c.evaluate("count"), 2, "state persists");

    // 9.2 Functions persist
    c.evaluate("function add(a, b) { return a + b; }");
    assert(c.evaluate("add(3, 4)"), 7, "function persists");

    // 9.3 State is compartment-specific
    var c2 = new Compartment();
    assert(c2.evaluate("typeof count"), "undefined", "state not shared between compartments");

    // 9.4 Object modifications persist
    c.evaluate("var obj = { n: 1 }");
    c.evaluate("obj.n = 10");
    assert(c.evaluate("obj.n"), 10, "object modification persists");
}

// ============================================================
// Test 10: Compartment does not pollute parent scope
// ============================================================

function test_no_parent_pollution() {
    var c = new Compartment();

    // 10.1 Variables created in compartment don't leak to parent
    c.evaluate("var compartmentOnly = 123");
    assert(typeof compartmentOnly, "undefined", "compartment var doesn't leak");

    // 10.2 Function created in compartment doesn't leak
    c.evaluate("function compartmentFunc() { return 'secret'; }");
    assert(typeof compartmentFunc, "undefined", "compartment function doesn't leak");
}

// ============================================================
// Run All Tests
// ============================================================

test_compartment_creation();
print("  test_compartment_creation passed");

test_globalThis_isolation();
print("  test_globalThis_isolation passed");

test_evaluate_basic();
print("  test_evaluate_basic passed");

test_globals_option();
print("  test_globals_option passed");

test_globalLexicals_option();
print("  test_globalLexicals_option passed");

test_shared_intrinsics();
print("  test_shared_intrinsics passed");

test_error_handling();
print("  test_error_handling passed");

test_nested_compartments();
print("  test_nested_compartments passed");

test_state_persistence();
print("  test_state_persistence passed");

test_no_parent_pollution();
print("  test_no_parent_pollution passed");

print("All Compartment tests passed!");
