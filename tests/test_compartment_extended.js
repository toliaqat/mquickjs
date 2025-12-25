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
// Extended Test 1: evaluate() Edge Cases
// These tests ensure evaluate() behavior is stable before we modify it
// ============================================================

function test_evaluate_edge_cases() {
    var c = new Compartment();

    // 1.1 Multi-line code
    var result = c.evaluate("var a = 1;\nvar b = 2;\na + b");
    assert(result, 3, "multi-line code");

    // 1.2 Code with semicolons
    assert(c.evaluate("1;2;3"), 3, "multiple expressions with semicolons");

    // 1.3 Code without trailing semicolon
    assert(c.evaluate("5 * 5"), 25, "no trailing semicolon");

    // 1.4 Only whitespace
    assert(c.evaluate("   \n\t  "), undefined, "whitespace only");

    // 1.5 Comments only
    assert(c.evaluate("// comment"), undefined, "comment only");

    // 1.6 Block comment
    assert(c.evaluate("/* block */ 42"), 42, "block comment");

    // 1.7 Return value of if statement
    assert(c.evaluate("if (true) 1"), 1, "if statement return value");
    assert(c.evaluate("if (false) 1"), undefined, "if false return value");

    // 1.8 Return value of loop
    c.evaluate("var sum = 0; for (var i = 0; i < 3; i++) sum += i;");
    assert(c.evaluate("sum"), 3, "loop side effect");

    // 1.9 Ternary expression
    assert(c.evaluate("true ? 'yes' : 'no'"), "yes", "ternary true");
    assert(c.evaluate("false ? 'yes' : 'no'"), "no", "ternary false");

    // 1.10 Logical operators return value
    assert(c.evaluate("1 && 2"), 2, "logical and");
    assert(c.evaluate("0 || 3"), 3, "logical or");

    // 1.11 Assignment expression returns assigned value
    c.evaluate("var z");
    assert(c.evaluate("z = 99"), 99, "assignment returns value");

    // 1.12 Comma operator
    assert(c.evaluate("(1, 2, 3)"), 3, "comma operator");

    // 1.13 typeof expression
    assert(c.evaluate("typeof undefined"), "undefined", "typeof undefined");
    assert(c.evaluate("typeof 42"), "number", "typeof number");
    assert(c.evaluate("typeof 'str'"), "string", "typeof string");
    assert(c.evaluate("typeof {}"), "object", "typeof object");
    assert(c.evaluate("typeof []"), "object", "typeof array");
    assert(c.evaluate("typeof function(){}"), "function", "typeof function");

    // 1.14 void expression
    assert(c.evaluate("void 0"), undefined, "void 0");
    assert(c.evaluate("void (1 + 2)"), undefined, "void expression");

    // 1.15 Unary operators
    assert(c.evaluate("-5"), -5, "unary minus");
    assert(c.evaluate("+'-5'"), -5, "unary plus coercion");
    assert(c.evaluate("!true"), false, "logical not");
    assert(c.evaluate("!!1"), true, "double not");

    // 1.16 String concatenation in evaluated code
    assert(c.evaluate("'hello' + ' ' + 'world'"), "hello world", "string concat");
}

// ============================================================
// Extended Test 2: Variable Resolution and Scoping
// Critical for globalLexicals implementation
// ============================================================

function test_variable_resolution() {
    var c = new Compartment();

    // 2.1 Declaring and reading global variable
    c.evaluate("var myGlobal = 'test'");
    assert(c.evaluate("myGlobal"), "test", "read declared global");

    // 2.2 Global is on globalThis
    assert(c.evaluate("globalThis.myGlobal"), "test", "global on globalThis");

    // 2.3 Modifying via globalThis
    c.evaluate("globalThis.myGlobal = 'modified'");
    assert(c.evaluate("myGlobal"), "modified", "modify via globalThis");

    // 2.4 typeof on undeclared variable (no ReferenceError)
    assert(c.evaluate("typeof neverDeclared"), "undefined", "typeof undeclared");

    // 2.5 Accessing undeclared throws ReferenceError
    assert_throws(ReferenceError, function() {
        c.evaluate("neverDeclared");
    });

    // 2.6 Variable hoisting
    assert(c.evaluate("(function() { var x = hoisted; var hoisted = 1; return x; })()"), undefined, "hoisting");

    // 2.7 Function hoisting
    assert(c.evaluate("(function() { return hoistedFn(); function hoistedFn() { return 42; } })()"), 42, "function hoisting");

    // 2.8 Block scope with var (should be function/global scoped)
    c.evaluate("if (true) { var blockVar = 'visible'; }");
    assert(c.evaluate("blockVar"), "visible", "var in block is visible");

    // 2.9 Shadowing in nested function
    c.evaluate("var outer = 'outer'");
    assert(c.evaluate("(function() { var outer = 'inner'; return outer; })()"), "inner", "shadow in function");
    assert(c.evaluate("outer"), "outer", "outer unchanged after shadow");

    // 2.10 Closure captures variable
    c.evaluate("var counter = 0; function increment() { counter++; }");
    c.evaluate("increment(); increment(); increment();");
    assert(c.evaluate("counter"), 3, "closure captured variable");
}

// ============================================================
// Extended Test 3: globals Option Edge Cases
// ============================================================

function test_globals_edge_cases() {
    // 3.1 Object with methods as global
    var obj = {
        value: 10,
        getValue: function() { return this.value; },
        setValue: function(v) { this.value = v; }
    };
    var c1 = new Compartment({ globals: { myObj: obj } });
    assert(c1.evaluate("myObj.getValue()"), 10, "object method this binding");
    c1.evaluate("myObj.setValue(20)");
    assert(obj.value, 20, "object modified from compartment");

    // 3.2 Array as global
    var arr = [1, 2, 3];
    var c2 = new Compartment({ globals: { myArr: arr } });
    assert(c2.evaluate("myArr.length"), 3, "array length");
    assert(c2.evaluate("myArr[1]"), 2, "array access");
    c2.evaluate("myArr.push(4)");
    assert(arr.length, 4, "array modified from compartment");

    // 3.3 null as global value
    var c3 = new Compartment({ globals: { nullVal: null } });
    assert(c3.evaluate("nullVal"), null, "null global");
    assert(c3.evaluate("nullVal === null"), true, "null comparison");

    // 3.4 undefined as global value
    var c4 = new Compartment({ globals: { undefVal: undefined } });
    assert(c4.evaluate("undefVal"), undefined, "undefined global");
    assert(c4.evaluate("typeof undefVal"), "undefined", "typeof undefined global");

    // 3.5 Number zero as global
    var c5 = new Compartment({ globals: { zero: 0, negZero: -0 } });
    assert(c5.evaluate("zero"), 0, "zero global");
    assert(c5.evaluate("zero === 0"), true, "zero comparison");

    // 3.6 Boolean false as global
    var c6 = new Compartment({ globals: { falseBool: false } });
    assert(c6.evaluate("falseBool"), false, "false global");
    assert(c6.evaluate("!falseBool"), true, "not false");

    // 3.7 Empty string as global
    var c7 = new Compartment({ globals: { emptyStr: "" } });
    assert(c7.evaluate("emptyStr"), "", "empty string global");
    assert(c7.evaluate("emptyStr.length"), 0, "empty string length");

    // 3.8 Many globals
    var manyGlobals = {};
    for (var i = 0; i < 50; i++) {
        manyGlobals["g" + i] = i;
    }
    var c8 = new Compartment({ globals: manyGlobals });
    assert(c8.evaluate("g0"), 0, "many globals - first");
    assert(c8.evaluate("g49"), 49, "many globals - last");
    assert(c8.evaluate("g25"), 25, "many globals - middle");

    // 3.9 Global with special characters in property name (via globalThis)
    var c9 = new Compartment({ globals: { "with-dash": 1, "with space": 2 } });
    assert(c9.evaluate("globalThis['with-dash']"), 1, "property with dash");
    assert(c9.evaluate("globalThis['with space']"), 2, "property with space");

    // 3.10 Overwriting global from inside compartment
    var c10 = new Compartment({ globals: { x: 1 } });
    c10.evaluate("x = 2");
    assert(c10.evaluate("x"), 2, "global overwritten");
    assert(c10.globalThis.x, 2, "globalThis reflects change");
}

// ============================================================
// Extended Test 4: Built-in Globals Access
// ============================================================

function test_builtin_globals() {
    var c = new Compartment();

    // 4.1 Array constructor
    assert(c.evaluate("Array(3).length"), 3, "Array constructor");
    assert(c.evaluate("Array.isArray([])"), true, "Array.isArray");

    // 4.2 Object methods
    assert(c.evaluate("Object.keys({a:1, b:2}).length"), 2, "Object.keys");

    // 4.3 Math object
    assert(c.evaluate("Math.max(1, 2, 3)"), 3, "Math.max");
    assert(c.evaluate("Math.min(1, 2, 3)"), 1, "Math.min");
    assert(c.evaluate("Math.abs(-5)"), 5, "Math.abs");
    assert(c.evaluate("Math.floor(3.7)"), 3, "Math.floor");

    // 4.4 JSON
    assert(c.evaluate("JSON.stringify({a:1})"), '{"a":1}', "JSON.stringify");
    var parsed = c.evaluate("JSON.parse('{\"b\":2}')");
    assert(parsed.b, 2, "JSON.parse");

    // 4.5 String methods
    assert(c.evaluate("'hello'.toUpperCase()"), "HELLO", "String.toUpperCase");
    assert(c.evaluate("'  trim  '.trim()"), "trim", "String.trim");
    assert(c.evaluate("'abc'.indexOf('b')"), 1, "String.indexOf");

    // 4.6 Array methods
    assert(c.evaluate("[1,2,3].join('-')"), "1-2-3", "Array.join");
    assert(c.evaluate("[1,2,3].map(function(x){return x*2;}).join(',')"), "2,4,6", "Array.map");
    assert(c.evaluate("[1,2,3,4].filter(function(x){return x>2;}).length"), 2, "Array.filter");

    // 4.7 Number methods
    assert(c.evaluate("(3.14159).toFixed(2)"), "3.14", "Number.toFixed");
    assert(c.evaluate("parseInt('42')"), 42, "parseInt");
    assert(c.evaluate("parseFloat('3.14')"), 3.14, "parseFloat");

    // 4.8 isNaN and isFinite
    assert(c.evaluate("isNaN(NaN)"), true, "isNaN");
    assert(c.evaluate("isFinite(100)"), true, "isFinite");
    assert(c.evaluate("isFinite(Infinity)"), false, "isFinite Infinity");

    // 4.9 Error constructors
    var err = c.evaluate("new Error('test')");
    assert(err instanceof Error, true, "Error constructor");
    assert(err.message, "test", "Error message");

    // 4.10 TypedArrays
    assert(c.evaluate("new Uint8Array(4).length"), 4, "Uint8Array");
    assert(c.evaluate("new Int32Array([1,2,3])[1]"), 2, "Int32Array with values");
}

// ============================================================
// Extended Test 5: this Binding in Compartment
// Important for globalLexicals IIFE approach
// ============================================================

function test_this_binding() {
    var c = new Compartment();

    // 5.1 this at top-level in compartment evaluate (without lexicals) is null
    assert(c.evaluate("this"), null, "this is null at top level without lexicals");

    // 5.2 this with globalLexicals is globalThis (IIFE uses globalThis as this)
    var c2 = new Compartment({ globalLexicals: { x: 1 } });
    assert(c2.evaluate("this") === c2.globalThis, true, "this is globalThis with lexicals");

    // 5.3 this in regular function call returns undefined in MicroQuickJS
    c.evaluate("function getThis() { return this; }");
    var fnThis = c.evaluate("getThis()");
    assert(fnThis, undefined, "this in function call is undefined");

    // 5.4 this in method call
    c.evaluate("var obj = { getThis: function() { return this; } }");
    assert(c.evaluate("obj.getThis() === obj"), true, "this in method is receiver");

    // 5.5 Explicit this binding with call
    c.evaluate("function showX() { return this.x; }");
    assert(c.evaluate("showX.call({x: 42})"), 42, "call with explicit this");

    // 5.6 Explicit this binding with apply (MicroQuickJS requires array arg)
    assert(c.evaluate("showX.apply({x: 99}, [])"), 99, "apply with explicit this");

    // 5.7 bind
    c.evaluate("var bound = showX.bind({x: 123})");
    assert(c.evaluate("bound()"), 123, "bound function");
}

// ============================================================
// Extended Test 6: Closures Across evaluate() Calls
// ============================================================

function test_closures() {
    var c = new Compartment();

    // 6.1 Create closure in one evaluate, use in another
    c.evaluate("function makeCounter(start) { var count = start; return function() { return count++; }; }");
    c.evaluate("var counter = makeCounter(10)");
    assert(c.evaluate("counter()"), 10, "closure first call");
    assert(c.evaluate("counter()"), 11, "closure second call");
    assert(c.evaluate("counter()"), 12, "closure third call");

    // 6.2 Multiple closures sharing state
    c.evaluate("var shared = 0; function inc() { shared++; } function get() { return shared; }");
    c.evaluate("inc(); inc();");
    assert(c.evaluate("get()"), 2, "closures share state");

    // 6.3 Closure captures by reference
    c.evaluate("var ref = 1; function getRef() { return ref; }");
    assert(c.evaluate("getRef()"), 1, "closure initial");
    c.evaluate("ref = 100");
    assert(c.evaluate("getRef()"), 100, "closure sees update");

    // 6.4 IIFE doesn't leak variables
    c.evaluate("var iife_result = (function() { var secret = 'hidden'; return secret.length; })()");
    assert(c.evaluate("iife_result"), 6, "IIFE returns value");
    assert(c.evaluate("typeof secret"), "undefined", "IIFE secret is not leaked");
}

// ============================================================
// Extended Test 7: Interaction between globals and code
// ============================================================

function test_globals_code_interaction() {
    // 7.1 Global function called by compartment code
    var callCount = 0;
    var c1 = new Compartment({
        globals: {
            trackCall: function() { callCount++; }
        }
    });
    c1.evaluate("trackCall(); trackCall(); trackCall();");
    assert(callCount, 3, "global function called multiple times");

    // 7.2 Global callback used in array method
    var results = [];
    var c2 = new Compartment({
        globals: {
            collect: function(x) { results.push(x); }
        }
    });
    c2.evaluate("[1, 2, 3].forEach(function(x) { collect(x * 10); })");
    assert(results.length, 3, "callback invoked for each");
    assert(results[0], 10, "callback first value");
    assert(results[2], 30, "callback last value");

    // 7.3 Compartment code modifies global object
    var state = { count: 0 };
    var c3 = new Compartment({ globals: { state: state } });
    c3.evaluate("for (var i = 0; i < 5; i++) state.count++");
    assert(state.count, 5, "global object modified by loop");

    // 7.4 Global function returns value used by compartment
    var c4 = new Compartment({
        globals: {
            getData: function() { return { items: [1, 2, 3] }; }
        }
    });
    assert(c4.evaluate("getData().items.reduce(function(a,b){return a+b;}, 0)"), 6, "use returned data");

    // 7.5 Compartment stores function, parent calls it
    var c5 = new Compartment();
    c5.evaluate("function greet(name) { return 'Hello, ' + name + '!'; }");
    var greetFn = c5.globalThis.greet;
    assert(greetFn("World"), "Hello, World!", "call compartment function from parent");
}

// ============================================================
// Extended Test 8: RegExp in Compartment
// ============================================================

function test_regexp() {
    var c = new Compartment();

    // 8.1 RegExp literal
    assert(c.evaluate("/abc/.test('xabcy')"), true, "regexp literal test");

    // 8.2 RegExp constructor
    assert(c.evaluate("new RegExp('def').test('xdefy')"), true, "RegExp constructor");

    // 8.3 String match
    var match = c.evaluate("'hello123world'.match(/[0-9]+/)");
    assert(match[0], "123", "String match");

    // 8.4 String replace
    assert(c.evaluate("'aabbcc'.replace(/b+/, 'X')"), "aaXcc", "String replace");

    // 8.5 String split with regexp
    var parts = c.evaluate("'a1b2c3'.split(/[0-9]/)");
    assert(parts.length, 4, "split with regexp");
    assert(parts[0], "a", "split first part");

    // 8.6 RegExp flags
    assert(c.evaluate("/abc/i.test('ABC')"), true, "case insensitive flag");

    // 8.7 Global flag and exec
    c.evaluate("var re = /a/g; var str = 'abaca';");
    assert(c.evaluate("re.exec(str)[0]"), "a", "first exec");
    assert(c.evaluate("re.exec(str)[0]"), "a", "second exec advances");
}

// ============================================================
// Extended Test 9: Date in Compartment
// MicroQuickJS has limited Date support (only Date.now())
// ============================================================

function test_date() {
    var c = new Compartment();

    // 9.1 Date.now is available and returns a number
    var now = c.evaluate("Date.now()");
    assert(typeof now, "number", "Date.now is number");
    assert(now > 0, true, "Date.now is positive");

    // 9.2 Date.now returns increasing values
    var now2 = c.evaluate("Date.now()");
    assert(now2 >= now, true, "Date.now is non-decreasing");

    // 9.3 Date constructor exists
    assert(c.evaluate("typeof Date"), "function", "Date is function");
}

// ============================================================
// Extended Test 10: Prototype Modification Across Compartments
// ============================================================

function test_prototype_sharing() {
    var c1 = new Compartment();
    var c2 = new Compartment();

    // 10.1 Modifying prototype in one compartment affects others
    c1.evaluate("Array.prototype.sum = function() { var s = 0; for (var i = 0; i < this.length; i++) s += this[i]; return s; }");

    // 10.2 Second compartment sees the modification
    assert(c2.evaluate("[1, 2, 3].sum()"), 6, "prototype method visible in c2");

    // 10.3 Parent context sees the modification
    assert([4, 5, 6].sum(), 15, "prototype method visible in parent");

    // 10.4 Clean up - remove the added method
    delete Array.prototype.sum;
}

// ============================================================
// Run All Extended Tests
// ============================================================

test_evaluate_edge_cases();
print("  test_evaluate_edge_cases passed");

test_variable_resolution();
print("  test_variable_resolution passed");

test_globals_edge_cases();
print("  test_globals_edge_cases passed");

test_builtin_globals();
print("  test_builtin_globals passed");

test_this_binding();
print("  test_this_binding passed");

test_closures();
print("  test_closures passed");

test_globals_code_interaction();
print("  test_globals_code_interaction passed");

test_regexp();
print("  test_regexp passed");

test_date();
print("  test_date passed");

test_prototype_sharing();
print("  test_prototype_sharing passed");

print("All extended Compartment tests passed!");
