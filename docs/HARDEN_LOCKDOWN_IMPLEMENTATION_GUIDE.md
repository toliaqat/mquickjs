# JavaScript harden() and lockdown() Implementation Guide

**Purpose**: This document provides comprehensive guidance for implementing the `harden()` and `lockdown()` functions from Hardened JavaScript (SES - Secure ECMAScript) in a JavaScript engine (V8, SpiderMonkey, JavaScriptCore, or others). It is based on the Moddable XS implementation and the SES specification.

**Version**: Based on SES/Hardened JavaScript and Moddable XS implementation as of December 2024.

---

## Table of Contents

1. [Overview and Purpose](#1-overview-and-purpose)
2. [Core Concepts](#2-core-concepts)
3. [API Specification](#3-api-specification)
4. [Implementation Architecture](#4-implementation-architecture)
5. [Taming and Security Measures](#5-taming-and-security-measures)
6. [Test Suite](#6-test-suite)
7. [Implementation Checklist](#7-implementation-checklist)

---

## 1. Overview and Purpose

### 1.1 What Are harden() and lockdown()?

`harden()` and `lockdown()` are security primitives that form the foundation of Hardened JavaScript (formerly Secure ECMAScript or SES):

- **lockdown()**: Tamper-proofs the JavaScript realm by freezing all intrinsic objects (built-ins), preventing prototype pollution attacks and establishing a secure baseline.

- **harden()**: Recursively freezes an object graph, making the entire reachable object structure immutable on its surface.

Together with Compartments, these primitives enable:
- **Isolation**: Programs cannot observe or affect each other
- **Integrity**: Built-in objects cannot be tampered with
- **Attenuation**: Capability-based security through controlled object sharing

### 1.2 Key Design Principles

1. **Defense in Depth**: Multiple layers of protection (lockdown for intrinsics, harden for user objects, compartments for isolation)

2. **Fail-Safe Defaults**: After lockdown, the environment is secure by default

3. **Transitive Freezing**: harden() doesn't just freeze the immediate object - it freezes the entire reachable object graph

4. **Compatibility**: Hardened code should run correctly in non-hardened environments

5. **Covert Channel Prevention**: Block timing attacks and hidden communication between isolated programs

### 1.3 Relationship with Compartments

```
┌──────────────────────────────────────────────────────────────┐
│                        Hardened JavaScript                    │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐ │
│  │  lockdown() │ + │  harden()   │ + │    Compartments     │ │
│  │             │   │             │   │                     │ │
│  │ Freeze all  │   │ Freeze user │   │ Isolate programs    │ │
│  │ intrinsics  │   │ objects     │   │ with separate       │ │
│  │             │   │ transitively│   │ globals & modules   │ │
│  └─────────────┘   └─────────────┘   └─────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Core Concepts

### 2.1 Intrinsics

**Intrinsics** are the built-in objects defined by the ECMAScript specification:

| Category | Objects |
|----------|---------|
| Constructors | Object, Function, Array, String, Number, Boolean, Symbol, BigInt, Error, etc. |
| Prototypes | Object.prototype, Function.prototype, Array.prototype, etc. |
| Functions | eval, parseInt, parseFloat, isNaN, isFinite, etc. |
| Objects | Math, JSON, Reflect, Atomics |
| Iterators | %ArrayIteratorPrototype%, %StringIteratorPrototype%, etc. |

### 2.2 Object Freezing Levels

JavaScript provides three levels of object mutability restriction:

| Level | Function | Prevents |
|-------|----------|----------|
| Non-extensible | `Object.preventExtensions()` | Adding new properties |
| Sealed | `Object.seal()` | Adding/deleting properties, changing configurability |
| Frozen | `Object.freeze()` | All mutations (data properties become read-only) |

`harden()` applies `Object.freeze()` transitively to the entire object graph.

### 2.3 Deep Freeze vs harden()

While `Object.freeze()` only freezes the immediate object:

```javascript
const obj = { nested: { value: 1 } };
Object.freeze(obj);
obj.nested.value = 2;  // Still works! Nested object is mutable
```

`harden()` freezes transitively:

```javascript
const obj = { nested: { value: 1 } };
harden(obj);
obj.nested.value = 2;  // TypeError: Cannot assign to read only property
```

### 2.4 Private Fields and harden()

**Important**: Private fields remain mutable even after `harden()`:

```javascript
class Counter {
  #count = 0;
  increment() { return ++this.#count; }
}

const counter = harden(new Counter());
counter.increment();  // Returns 1 - private state can still change
```

This is by design: private fields are truly private and not accessible via the object graph, so they cannot be "frozen" in the same way.

### 2.5 Stamp Prevention

A key security feature of `harden()` is **stamp prevention**. In JavaScript, external code can add private fields to objects using a class constructor trick:

```javascript
class Stamper extends class {
  constructor(obj) { return obj; }  // Return the passed object
} {
  #stamp = "marked";
  static hasStamp(obj) { return #stamp in obj; }
}

const victim = {};
new Stamper(victim);  // Stamps the victim with #stamp
Stamper.hasStamp(victim);  // true
```

**Hardened objects prevent stamping**:

```javascript
const safe = harden({});
new Stamper(safe);  // TypeError: Cannot define private field on hardened object
```

This prevents external code from tagging or marking hardened objects.

---

## 3. API Specification

### 3.1 lockdown()

```typescript
function lockdown(options?: LockdownOptions): void
```

#### LockdownOptions

```typescript
interface LockdownOptions {
  // Error taming: 'safe' removes stack traces, 'unsafe' preserves them
  errorTaming?: 'safe' | 'unsafe';

  // Math.random taming: 'safe' disables in compartments
  mathTaming?: 'safe' | 'unsafe';

  // Date.now taming: 'safe' disables in compartments
  dateTaming?: 'safe' | 'unsafe';

  // Locale methods taming: 'safe' uses locale-independent versions
  localeTaming?: 'safe' | 'unsafe';

  // Console taming: 'safe' virtualizes console
  consoleTaming?: 'safe' | 'unsafe';

  // Stack filtering for debugging
  stackFiltering?: 'concise' | 'verbose';

  // Override mistakes in the spec
  overrideTaming?: 'moderate' | 'min' | 'severe';
}
```

#### lockdown() Behavior

1. **Prevent Re-entry**: Throw TypeError if already called
2. **Freeze All Intrinsics**: Make all built-in objects and prototypes immutable
3. **Tame Dangerous Objects**:
   - Replace `Date` constructor with secure version
   - Replace `Math.random` with secure version
   - Remove RegExp.prototype.compile
   - Tame Error stack traces
   - Replace locale-dependent methods
4. **Freeze Hidden Intrinsics**: Freeze iterator prototypes and other non-global intrinsics
5. **Replace Constructors on Prototypes**: Make Function.prototype.constructor, etc. throw

#### lockdown() Returns

`lockdown()` returns `undefined` but has the side effect of permanently modifying the realm.

### 3.2 harden()

```typescript
function harden<T>(object: T): T
```

#### harden() Behavior

1. **Accept Object Reference**: Take any object as input
2. **Check Already Hardened**: If object has hardened flag, return immediately
3. **Build Object Queue**: Start with the input object
4. **For Each Object in Queue**:
   a. Call `Object.preventExtensions(object)`
   b. Get all own property keys
   c. For each property:
      - Make non-configurable
      - Make non-writable (if data property)
   d. Add prototype to queue (if reference type)
   e. Add all property values to queue (if reference type)
   f. Add accessor getter/setter functions to queue
5. **Mark All Objects as Hardened**: Set internal flag
6. **Return Original Object**: Allow chaining

#### harden() Error Handling

If any object in the graph cannot be frozen (e.g., a Proxy that rejects preventExtensions), `harden()` must:
1. Roll back the hardened flag on all processed objects
2. Throw the original error

### 3.3 petrify() (XS Extension)

```typescript
function petrify(object: object): object
```

`petrify()` is an XS-specific function that freezes a single object (non-recursively) and also prevents internal slot modifications:

- ArrayBuffer data becomes read-only
- Date value becomes immutable
- Map/Set/WeakMap/WeakSet become read-only
- Private fields become non-configurable

### 3.4 mutabilities() (XS Extension)

```typescript
function mutabilities(object: object): string[]
```

Returns an array of strings describing all mutable paths in an object graph. Used for debugging and verification.

---

## 4. Implementation Architecture

### 4.1 Data Structures

#### Hardening Flag

Each object needs an internal flag to track hardening status:

```c
// In XS, this is XS_DONT_MARSHALL_FLAG
#define HARDENED_FLAG 0x80

typedef struct {
    // ... other fields
    uint8_t flags;  // Includes HARDENED_FLAG
} ObjectHeader;
```

#### Object Queue for Traversal

```c
typedef struct QueueItem {
    Object* object;
    struct QueueItem* next;
} QueueItem;

typedef struct {
    QueueItem* first;
    QueueItem* last;
} ObjectQueue;
```

### 4.2 Algorithm: harden()

```
harden(root):
  1. If root is not an object, return root
  2. If root has HARDENED_FLAG set, return root

  3. Create empty ObjectQueue
  4. Add root to queue

  5. Try:
       While queue is not empty:
         item = dequeue()
         object = item.object

         // Freeze the object
         If not PreventExtensions(object):
           Throw TypeError("extensible object")

         // Process all property keys
         keys = OwnPropertyKeys(object)
         For each key in keys:
           descriptor = GetOwnProperty(object, key)

           // Make property non-configurable
           descriptor.configurable = false

           // Make data properties non-writable
           If descriptor is DataDescriptor:
             descriptor.writable = false

           DefineOwnProperty(object, key, descriptor)

           // Queue property values and accessors
           If descriptor.value is Object:
             QueueIfNotHardened(descriptor.value)
           If descriptor.get is Object:
             QueueIfNotHardened(descriptor.get)
           If descriptor.set is Object:
             QueueIfNotHardened(descriptor.set)

         // Queue prototype
         prototype = GetPrototypeOf(object)
         If prototype is Object:
           QueueIfNotHardened(prototype)

         // Mark as hardened
         object.flags |= HARDENED_FLAG

     Catch error:
       // Rollback: clear hardened flags
       For each processed in queue:
         processed.flags &= ~HARDENED_FLAG
       Throw error

  6. Return root
```

### 4.3 Algorithm: lockdown()

```
lockdown():
  1. If program already locked down (LOCKDOWN_FLAG set):
       Throw TypeError("lockdown already called")

  2. Set LOCKDOWN_FLAG on program

  3. Tame Function Constructors:
       // Replace constructors on prototypes with throwing functions
       Function.prototype.constructor = ThrowTypeError
       AsyncFunction.prototype.constructor = ThrowTypeError
       GeneratorFunction.prototype.constructor = ThrowTypeError
       AsyncGeneratorFunction.prototype.constructor = ThrowTypeError
       Compartment.prototype.constructor = ThrowTypeError

  4. Create Compartment Global Template:
       // Store intrinsics for compartment creation
       compartmentGlobals = CreateIntrinsicsArray()

  5. Tame Date:
       // Create secure Date constructor
       SecureDate = CloneFunction(Date)
       SecureDate.call = SecureDateConstructor  // Returns NaN or fixed value
       SecureDate.now = () => NaN               // Disable Date.now

  6. Tame Math:
       SecureMath = CloneObject(Math)
       SecureMath.random = ThrowTypeError       // Disable Math.random

  7. Get harden function reference

  8. Harden All Intrinsics:
       For each intrinsic in Intrinsics:
         harden(intrinsic)

  9. Harden Hidden Intrinsics:
       harden(ArgumentsSloppyPrototype)
       harden(ArgumentsStrictPrototype)
       harden(ArrayIteratorPrototype)
       harden(AsyncFromSyncIteratorPrototype)
       harden(AsyncFunctionPrototype)
       harden(AsyncGeneratorFunctionPrototype)
       harden(AsyncGeneratorPrototype)
       harden(AsyncIteratorPrototype)
       harden(GeneratorFunctionPrototype)
       harden(GeneratorPrototype)
       harden(IteratorPrototype)
       harden(MapIteratorPrototype)
       harden(RegExpStringIteratorPrototype)
       harden(SetIteratorPrototype)
       harden(StringIteratorPrototype)
       harden(TypedArrayPrototype)

  10. Harden Internal Functions:
        harden(ArrayLengthAccessor.getter)
        harden(ArrayLengthAccessor.setter)
        harden(StringAccessor.getter)
        harden(StringAccessor.setter)
        harden(TypedArrayAccessor.getter)
        harden(TypedArrayAccessor.setter)

  11. Harden Array.prototype[Symbol.unscopables]

  12. Harden compartment global template

  13. Harden the harden function itself

  14. Harden ThrowTypeError function
```

### 4.4 Key Implementation Functions in XS

| Function | File | Lines | Purpose |
|----------|------|-------|---------|
| `fx_lockdown` | xsLockdown.c | 74-206 | Main lockdown implementation |
| `fx_lockdown_aux` | xsLockdown.c | 52-72 | Helper to replace prototype constructors |
| `fx_harden` | xsLockdown.c | 339-406 | Main harden implementation |
| `fx_hardenFreezeAndTraverse` | xsLockdown.c | 220-337 | Freeze object and queue references |
| `fx_hardenQueue` | xsLockdown.c | 208-218 | Add object to processing queue |
| `fx_petrify` | xsLockdown.c | 408-476 | Single-object freeze with internal slots |
| `fx_mutabilities` | xsLockdown.c | 486-560 | Analyze object mutability |

---

## 5. Taming and Security Measures

### 5.1 Date Taming

The `Date` object can leak information and enable covert timing channels:

```javascript
// Before lockdown
new Date();           // Returns current time
Date.now();           // Returns current timestamp

// After lockdown (in compartment)
new Date();           // Returns NaN or throws
Date.now();           // Returns NaN or throws
```

**Implementation**:
```c
void fx_Date_secure(txMachine* the) {
    // In secure mode, Date() returns NaN
    mxResult->value.number = C_NAN;
    mxResult->kind = XS_NUMBER_KIND;
}

void fx_Date_now_secure(txMachine* the) {
    mxResult->value.number = C_NAN;
    mxResult->kind = XS_NUMBER_KIND;
}
```

### 5.2 Math.random Taming

`Math.random()` is a covert channel that must be disabled:

```javascript
// Before lockdown
Math.random();  // Returns pseudo-random number

// After lockdown (in compartment)
Math.random();  // Throws TypeError
```

**Implementation**:
```c
void fx_Math_random_secure(txMachine* the) {
    mxTypeError("Math.random disabled in secure mode");
}
```

### 5.3 RegExp Taming

Remove the deprecated `compile` method:

```javascript
// Before lockdown
/test/.compile('new');  // Works (modifies regex)

// After lockdown
/test/.compile('new');  // TypeError: compile is not a function
```

### 5.4 Error Stack Taming

Error stacks can leak information about the runtime:

```javascript
// In 'safe' mode
try { throw new Error(); } catch(e) { e.stack; }  // undefined or sanitized

// In 'unsafe' mode (for debugging)
try { throw new Error(); } catch(e) { e.stack; }  // Full stack trace
```

### 5.5 Locale Taming

Locale methods can reveal information about the host environment:

```javascript
// Before lockdown
"test".localeCompare("TEST");  // Locale-dependent result

// After lockdown
"test".localeCompare("TEST");  // Locale-independent result
```

### 5.6 Constructor Replacement

After lockdown, prototype constructor properties throw instead of constructing:

```javascript
// Before lockdown
Function.prototype.constructor('return 1')();  // Works, returns 1

// After lockdown
Function.prototype.constructor('return 1');  // TypeError
```

---

## 6. Test Suite

### 6.1 Core harden() Tests

#### Test: harden() Deep Freezes Objects
```javascript
lockdown();

class Class {
  constructor(it) {
    this.property = it;
  }
}

const object = new Class({});
Object.freeze(object);

// Object.freeze only freezes the immediate object
assert.sameValue(Object.isFrozen(object), true);
assert.sameValue(Object.isFrozen(Object.getPrototypeOf(object)), false);
assert.sameValue(Object.isFrozen(object.property), false);

// harden() freezes transitively
harden(object);
assert.sameValue(Object.isFrozen(object), true);
assert.sameValue(Object.isFrozen(Object.getPrototypeOf(object)), true);
assert.sameValue(Object.isFrozen(object.property), true);
```

#### Test: harden() Preserves Private Field Mutability
```javascript
lockdown();

class Class {
  #value;
  constructor(it) { this.#value = it; }
  get value() { return this.#value; }
  set value(it) { this.#value = it; }
}

const object = new Class("initial");
harden(object);

// Private fields remain mutable
object.value = "modified";
assert.sameValue(object.value, "modified");
```

#### Test: harden() Prevents Object Stamping
```javascript
lockdown();

const object = {};
const frozenObject = Object.freeze({});
const hardenedObject = harden({});

class Stamper extends class {
  constructor(obj) { return obj; }
} {
  #stamp = "marked";
  static getStamp(obj) { return obj.#stamp; }
}

// Regular objects can be stamped
new Stamper(object);
assert.sameValue(Stamper.getStamp(object), "marked");

// Frozen objects can be stamped
new Stamper(frozenObject);
assert.sameValue(Stamper.getStamp(frozenObject), "marked");

// Hardened objects CANNOT be stamped
assert.throws(TypeError, () => new Stamper(hardenedObject));
```

#### Test: harden() Returns the Same Object
```javascript
lockdown();

const obj = { a: 1 };
const result = harden(obj);
assert.sameValue(result, obj);
```

#### Test: harden() Handles Primitives
```javascript
lockdown();

// Primitives pass through unchanged
assert.sameValue(harden(42), 42);
assert.sameValue(harden("string"), "string");
assert.sameValue(harden(true), true);
assert.sameValue(harden(null), null);
assert.sameValue(harden(undefined), undefined);
assert.sameValue(harden(Symbol.for("test")), Symbol.for("test"));
```

#### Test: harden() Handles Circular References
```javascript
lockdown();

const a = { b: null };
const b = { a: a };
a.b = b;

harden(a);

assert.sameValue(Object.isFrozen(a), true);
assert.sameValue(Object.isFrozen(b), true);
assert.sameValue(Object.isFrozen(a.b), true);
assert.sameValue(Object.isFrozen(b.a), true);
```

#### Test: harden() Freezes Accessor Functions
```javascript
lockdown();

const getter = function() { return 1; };
const setter = function(v) {};
const obj = Object.defineProperty({}, 'x', {
  get: getter,
  set: setter,
  configurable: true
});

harden(obj);

assert.sameValue(Object.isFrozen(obj), true);
assert.sameValue(Object.isFrozen(getter), true);
assert.sameValue(Object.isFrozen(setter), true);
```

### 6.2 lockdown() Tests

#### Test: lockdown() Can Only Be Called Once
```javascript
lockdown();
assert.throws(TypeError, () => lockdown());
```

#### Test: lockdown() Freezes Intrinsics
```javascript
lockdown();

// Built-in prototypes are frozen
assert.sameValue(Object.isFrozen(Object.prototype), true);
assert.sameValue(Object.isFrozen(Array.prototype), true);
assert.sameValue(Object.isFrozen(Function.prototype), true);
assert.sameValue(Object.isFrozen(String.prototype), true);

// Built-in constructors are frozen
assert.sameValue(Object.isFrozen(Object), true);
assert.sameValue(Object.isFrozen(Array), true);
assert.sameValue(Object.isFrozen(Function), true);
```

#### Test: lockdown() Makes Properties Non-Writable
```javascript
lockdown();

// Cannot modify built-in prototype properties
assert.throws(TypeError, () => {
  Object.prototype.toString = function() { return "hacked"; };
});

// Cannot add properties to frozen objects
assert.throws(TypeError, () => {
  Object.prototype.newProp = "value";
});
```

#### Test: lockdown() Replaces Prototype Constructors
```javascript
lockdown();

// Prototype constructors throw
assert.throws(TypeError, () => Function.prototype.constructor(""));
assert.throws(TypeError, () => Object.getPrototypeOf(async function(){}).constructor(""));
```

#### Test: lockdown() Tames Date in Compartments
```javascript
lockdown();

const c = new Compartment({});

// Date is tamed in compartments
const result = c.evaluate("new Date().getTime()");
assert.sameValue(Number.isNaN(result), true);

const now = c.evaluate("Date.now()");
assert.sameValue(Number.isNaN(now), true);
```

#### Test: lockdown() Tames Math.random in Compartments
```javascript
lockdown();

const c = new Compartment({});

assert.throws(TypeError, () => {
  c.evaluate("Math.random()");
});
```

### 6.3 Immutable ArrayBuffer Tests

#### Test: transferToImmutable Creates Immutable Buffer
```javascript
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
view.setInt32(0, 42);

const immutable = buffer.transferToImmutable();

assert.sameValue(immutable.immutable, true);
assert.sameValue(buffer.byteLength, 0);  // Original is detached

// Reading works
const immutableView = new DataView(immutable);
assert.sameValue(immutableView.getInt32(0), 42);

// Writing throws
assert.throws(TypeError, () => immutableView.setInt32(0, 100));
```

#### Test: TypedArray Operations Fail on Immutable Buffer
```javascript
const buffer = new ArrayBuffer(8);
const immutable = buffer.transferToImmutable();
const arr = new Uint8Array(immutable);

// Read operations work
assert.sameValue(arr[0], 0);

// Write operations throw
assert.throws(TypeError, () => arr.fill(1));
assert.throws(TypeError, () => arr.copyWithin(0, 1));
assert.throws(TypeError, () => arr.reverse());
assert.throws(TypeError, () => arr.sort());
assert.throws(TypeError, () => { arr[0] = 1; });
```

### 6.4 Integration Tests

#### Test: Hardened Object Graph Integrity
```javascript
lockdown();

const shared = { counter: 0 };
const obj = harden({
  shared: shared,
  increment() { this.shared.counter++; }
});

// Calling methods works (accesses hardened internal state)
// But the shared object is now frozen
assert.throws(TypeError, () => obj.increment());
```

#### Test: Compartment with Hardened Globals
```javascript
lockdown();

const api = harden({
  log: (msg) => console.log(msg),
  compute: (a, b) => a + b
});

const c = new Compartment({
  globals: { api }
});

// Compartment can use hardened API
const result = c.evaluate("api.compute(1, 2)");
assert.sameValue(result, 3);

// Cannot modify hardened API
assert.throws(TypeError, () => c.evaluate("api.log = null"));
```

---

## 7. Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add HARDENED_FLAG to object header structure
- [ ] Add LOCKDOWN_FLAG to program/realm structure
- [ ] Implement object queue for graph traversal
- [ ] Implement circular reference detection

### Phase 2: harden() Implementation
- [ ] Implement basic object freezing
- [ ] Implement property enumeration and configuration
- [ ] Implement prototype traversal
- [ ] Implement accessor function traversal
- [ ] Implement rollback on error
- [ ] Handle primitives (pass-through)
- [ ] Handle already-hardened objects (fast path)

### Phase 3: lockdown() Implementation
- [ ] Implement single-call enforcement
- [ ] Collect all intrinsic objects
- [ ] Replace prototype constructor properties
- [ ] Implement Date taming
- [ ] Implement Math.random taming
- [ ] Harden all intrinsics
- [ ] Harden hidden intrinsics (iterators, etc.)
- [ ] Harden internal accessor functions

### Phase 4: Taming
- [ ] Date constructor secure mode
- [ ] Date.now secure mode
- [ ] Math.random secure mode
- [ ] RegExp.prototype.compile removal
- [ ] Error stack taming (optional)
- [ ] Locale method taming (optional)

### Phase 5: Stamp Prevention
- [ ] Detect private field installation attempts
- [ ] Throw TypeError for hardened objects
- [ ] Ensure frozen objects allow stamping (spec compliance)

### Phase 6: Immutable ArrayBuffer (Optional)
- [ ] Implement ArrayBuffer.prototype.transferToImmutable
- [ ] Implement ArrayBuffer.prototype.immutable getter
- [ ] Block TypedArray write operations
- [ ] Block DataView write operations

### Phase 7: Testing and Verification
- [ ] Run core harden() tests
- [ ] Run lockdown() tests
- [ ] Run integration tests with Compartments
- [ ] Run Test262 in lockdown mode
- [ ] Document expected test failures

---

## Appendix A: Expected Test262 Failures in Lockdown Mode

When running Test262 in lockdown mode, many tests fail because they assume mutable built-ins. Common failure patterns:

| Pattern | Example | Reason |
|---------|---------|--------|
| Property writability | `writable: true` expected | Properties are non-writable after lockdown |
| Property configurability | `configurable: true` expected | Properties are non-configurable |
| Object extensibility | Adding properties | Objects are non-extensible |
| Prototype modification | `Array.prototype.foo = bar` | Prototypes are frozen |
| Constructor replacement | Replacing `Array` | Constructors are frozen |

The XS implementation documents ~3,500+ expected failures in `xs/tools/test262/built-ins-lockdown.yaml`.

---

## Appendix B: Key Files in XS Implementation

| File | Purpose |
|------|---------|
| `xs/sources/xsLockdown.c` | Core lockdown, harden, petrify, mutabilities implementation |
| `xs/sources/xsAll.h` | Header declarations and flag definitions |
| `tests/xs/built-ins/harden/*.js` | Unit tests for harden() |
| `xs/tools/test262/built-ins-lockdown.yaml` | Test262 configuration for lockdown mode |
| `xs/tools/test262/built-ins-lockdown-compartment.yaml` | Test262 config for lockdown + compartment |

---

## Appendix C: SES/Hardened JavaScript References

- **SES (Secure ECMAScript)**: https://github.com/endojs/endo/tree/master/packages/ses
- **Hardened JavaScript**: https://hardenedjs.org/
- **Agoric SES Shim**: https://github.com/AgoricProposal/proposal-hardened-javascript
- **Frozen Realms Proposal**: https://github.com/tc39/proposal-frozen-realms

---

## Appendix D: Security Considerations

### Threat Model

`harden()` and `lockdown()` protect against:

1. **Prototype Pollution**: Cannot add/modify properties on prototypes
2. **Method Tampering**: Cannot replace built-in methods
3. **Covert Channels**: Date/Math.random disabled
4. **Object Tagging**: Cannot stamp hardened objects with private fields
5. **Constructor Abuse**: Cannot use prototype.constructor

### Limitations

These functions do NOT protect against:

1. **Resource Exhaustion**: Infinite loops, memory exhaustion
2. **Side Channels**: CPU timing, power analysis
3. **Private State Mutation**: Private fields remain mutable
4. **Closure State**: Functions can close over mutable variables

---

*This document was generated from analysis of the Moddable XS JavaScript engine implementation and the SES specification.*
