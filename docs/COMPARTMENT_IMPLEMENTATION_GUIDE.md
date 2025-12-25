# JavaScript Compartments Implementation Guide

**Purpose**: This document provides comprehensive guidance for implementing the TC39 Compartments proposal in a JavaScript engine (V8, SpiderMonkey, JavaScriptCore, or others). It is based on the Moddable XS implementation and the TC39 proposal specification.

**Version**: Based on TC39 Compartments Proposal (Stage 1) and Moddable XS implementation as of December 2024.

---

## Table of Contents

1. [Overview and Purpose](#1-overview-and-purpose)
2. [Core Concepts](#2-core-concepts)
3. [API Specification](#3-api-specification)
4. [Implementation Architecture](#4-implementation-architecture)
5. [Module Loading System](#5-module-loading-system)
6. [Test Suite](#6-test-suite)
7. [Implementation Checklist](#7-implementation-checklist)

---

## 1. Overview and Purpose

### 1.1 What Are Compartments?

Compartments are a mechanism for **isolating and providing limited power to programs within a shared realm**. They enable:

- **Isolation**: Each compartment has its own `globalThis` object, global lexical scope, and module map
- **Attenuation**: Parent compartments control what capabilities child compartments receive
- **Module Virtualization**: Custom module loading and resolution without affecting the host environment
- **Security**: Limiting access to powerful objects for untrusted code

### 1.2 Key Design Principles

1. **Shared Intrinsics**: Built-in prototypes (Array.prototype, Object.prototype, etc.) are shared across compartments within a realm, but `Compartment`, `Function`, and `eval` are compartment-specific.

2. **Separate Global Objects**: Each compartment has its own `globalThis`, preventing pollution between isolated code.

3. **Hierarchical Attenuation**: A child compartment can only access capabilities explicitly provided by its parent.

4. **Module Map Isolation**: Each compartment maintains its own module registry, so the same specifier can resolve to different modules.

5. **No Promise Requirement for Synchronous Hosts**: The `importNow()` and `loadNowHook` APIs enable synchronous module loading for environments without Promise support.

### 1.3 Use Cases

- Sandboxing untrusted third-party code
- Running plugins with limited capabilities
- Multi-tenant environments sharing a runtime
- Testing with isolated module graphs
- Polyfilling or virtualizing host APIs

---

## 2. Core Concepts

### 2.1 Realm vs Compartment

A **Realm** (per ECMA-262) consists of:
- A set of intrinsic objects
- A global environment
- All code loaded within that environment

A **Compartment** virtualizes a realm by providing:
- A separate `globalThis` object
- A separate global lexical scope
- A separate module map
- Custom module loading hooks

Multiple compartments share the same realm's intrinsics but have isolated execution environments.

### 2.2 Module Map

Each compartment maintains a **module map** that binds module specifiers to modules:

```
ModuleMap: Map<string, Module>
```

The same specifier always resolves to the same module within a compartment, but different compartments can map the same specifier to different modules.

### 2.3 Module Descriptors

Module descriptors describe how to load or reference modules. There are several forms:

| Descriptor Type | Properties | Description |
|----------------|------------|-------------|
| Source-based | `{ source: ModuleSource, importMeta?, specifier? }` | Load from parsed module source |
| String source | `{ source: string, importMeta?, specifier? }` | Load source code as string (parent parses) |
| Virtual source | `{ source: VirtualModuleSource, importMeta?, specifier? }` | Custom execute function with bindings |
| Namespace alias | `{ namespace: string, compartment? }` | Reference another compartment's module |
| Direct namespace | `{ namespace: ModuleExportsNamespace }` | Use existing namespace object |

### 2.4 Module Bindings

Module bindings describe import/export relationships without parsing:

```javascript
// Import bindings
{ import: "default", as: "localName", from: "moduleSpecifier" }
{ import: "namedExport", from: "moduleSpecifier" }
{ import: "named", as: "alias", from: "moduleSpecifier" }
{ importAllFrom: "moduleSpecifier", as: "namespace" }
{ importFrom: "moduleSpecifier" }  // side-effect only

// Export bindings
{ export: "localName" }
{ export: "localName", as: "exportedName" }
{ export: "imported", from: "moduleSpecifier" }
{ export: "imported", as: "reexported", from: "moduleSpecifier" }
{ exportAllFrom: "moduleSpecifier" }
{ exportAllFrom: "moduleSpecifier", as: "namespace" }
```

---

## 3. API Specification

### 3.1 Compartment Constructor

```typescript
new Compartment(options?: CompartmentOptions): Compartment
```

#### CompartmentOptions

```typescript
interface CompartmentOptions {
  // Properties to add to the compartment's globalThis
  globals?: Record<string, any>;

  // Variables for the global lexical scope (let/const)
  globalLexicals?: Record<string, any>;

  // Pre-defined module map
  modules?: Record<string, ModuleDescriptor>;

  // Resolve import specifiers to full specifiers (SYNCHRONOUS)
  resolveHook?: (importSpecifier: string, referrerSpecifier: string) => string;

  // Load module descriptors asynchronously
  loadHook?: (specifier: string) => Promise<ModuleDescriptor>;

  // Load module descriptors synchronously
  loadNowHook?: (specifier: string) => ModuleDescriptor;
}
```

#### Constructor Behavior

1. Create a new program instance
2. Create a new global object with built-in intrinsics
3. If `globals` is provided, copy properties to `globalThis` using `Object.assign` semantics
4. If `globalLexicals` is provided, create lexical bindings:
   - Writable properties become `let` bindings
   - Non-writable properties become `const` bindings
   - Only own enumerable string-keyed properties are used
5. If `modules` is provided, populate the module map (do NOT load or initialize)
6. Store hooks for later use

### 3.2 Compartment.prototype.globalThis

```typescript
get globalThis(): object
```

Returns the compartment's isolated global object. This object:
- Contains standard built-in objects (Array, Object, etc.)
- Has compartment-specific `eval`, `Function`, and `Compartment`
- Contains properties added via the `globals` option
- Does NOT contain `globalLexicals` (those are in the lexical scope)

### 3.3 Compartment.prototype.evaluate()

```typescript
evaluate(source: string): any
```

Evaluates JavaScript source code in the compartment's context:

1. Parse `source` as a Script (not Module)
2. Execute in strict mode
3. Use the compartment's global object as `this`
4. Use the compartment's global lexical scope
5. Return the completion value

**Important**: The evaluated code runs with the compartment's `eval` and `Function`, not the parent's.

### 3.4 Compartment.prototype.import()

```typescript
import(specifier: string): Promise<ModuleExportsNamespace>
```

Asynchronously loads and initializes a module:

1. Look up `specifier` in the module map
2. If not found, call `loadHook(specifier)` if defined
3. Recursively load dependencies using `resolveHook` for specifier resolution
4. Link all modules
5. Execute modules in dependency order
6. Return promise resolving to the module's namespace

### 3.5 Compartment.prototype.importNow()

```typescript
importNow(specifier: string): ModuleExportsNamespace
```

Synchronously loads and initializes a module:

1. Look up `specifier` in the module map
2. If not found, call `loadNowHook(specifier)` if defined
3. Recursively load dependencies synchronously
4. Link all modules
5. Execute modules in dependency order
6. Return the module's namespace directly

**Throws** if:
- A module uses top-level `await`
- No `loadNowHook` is provided and module is not in map
- Any dependency cannot be loaded synchronously

### 3.6 ModuleSource Constructor

```typescript
new ModuleSource(source: string, options?: ModuleSourceOptions): ModuleSource
```

Parses JavaScript module source code and extracts metadata:

```typescript
interface ModuleSourceOptions {
  type?: "javascript" | "json";  // Module type
}
```

### 3.7 ModuleSource.prototype Properties

```typescript
interface ModuleSource {
  // Array of binding descriptors for imports/exports
  get bindings(): ModuleBinding[];

  // True if module uses dynamic import()
  get needsImport(): boolean;

  // True if module uses import.meta
  get needsImportMeta(): boolean;
}
```

### 3.8 VirtualModuleSource

A plain object that acts as a module source:

```typescript
interface VirtualModuleSource {
  // Import/export bindings (no parsing needed)
  bindings?: ModuleBinding[];

  // Called when module executes
  execute: (
    $: ModuleEnvironmentRecord,
    Import?: (specifier: string) => Promise<ModuleExportsNamespace>,
    ImportMeta?: object
  ) => void | Promise<void>;

  // Whether Import parameter should be provided
  needsImport?: boolean;

  // Whether ImportMeta parameter should be provided
  needsImportMeta?: boolean;
}
```

The `$` parameter is a sealed object representing the module environment:
- Export bindings are writable
- Import bindings are read-only
- No properties can be added or deleted

---

## 4. Implementation Architecture

### 4.1 Data Structures

#### Program/Compartment Instance

```
CompartmentInstance {
  kind: PROGRAM_KIND
  realm: RealmInstance
  // ... other internal slots
}
```

#### Realm Instance

```
RealmInstance {
  global: GlobalObject           // The globalThis
  closures: LexicalEnvironment   // globalLexicals bindings
  templateCache: Map             // Tagged template cache
  modules: ModuleMap             // Loaded modules registry
  resolveHook: Function | null
  loadHook: Function | null
  loadNowHook: Function | null
  importMetaHook: Function | null
  moduleMap: Object | null       // Initial modules option
  parent: RealmInstance | null   // Parent compartment's realm
}
```

#### Module Instance

```
ModuleInstance {
  kind: MODULE_KIND
  realm: RealmInstance
  id: ModuleId
  status: ModuleStatus
  exports: ModuleExports
  transfers: ImportBindings[]
  execute: Function
  namespace: ModuleNamespace | null
  // Promise callbacks for async loading
  fulfill: Function | null
  reject: Function | null
}
```

#### Module Status Enum

```
enum ModuleStatus {
  NEW = 0,        // Just created
  LOADING = 1,    // Loading source
  LOADED = 2,     // Source loaded, not linked
  LINKING = 3,    // Currently linking
  LINKED = 4,     // Linked, not executed
  EXECUTING = 5,  // Currently executing
  EXECUTED = 6,   // Execution complete
  ERROR = 7       // Error during loading/linking/execution
}
```

### 4.2 Algorithm: Module Resolution

```
ResolveSpecifier(realm, importSpecifier, referrerSpecifier):
  1. If realm.resolveHook is defined:
     a. Call resolveHook(importSpecifier, referrerSpecifier)
     b. Return result as module specifier
  2. Else if realm.parent is not null:
     a. Return ResolveSpecifier(realm.parent, importSpecifier, referrerSpecifier)
  3. Else:
     a. Use host default resolution (file paths, URLs, etc.)
```

### 4.3 Algorithm: Module Loading (Async)

```
LoadModule(realm, specifier):
  1. If specifier is in realm.modules:
     a. Return realm.modules[specifier]

  2. If specifier is in realm.moduleMap (initial options):
     a. descriptor = realm.moduleMap[specifier]
     b. module = CreateModuleFromDescriptor(realm, descriptor, specifier)
     c. Add to realm.modules
     d. Return module

  3. If realm.loadHook is defined:
     a. descriptor = await realm.loadHook(specifier)
     b. module = CreateModuleFromDescriptor(realm, descriptor, specifier)
     c. Add to realm.modules
     d. Return module

  4. Throw Error("Module not found: " + specifier)
```

### 4.4 Algorithm: Module Loading (Sync)

```
LoadModuleNow(realm, specifier):
  1. If specifier is in realm.modules:
     a. Return realm.modules[specifier]

  2. If specifier is in realm.moduleMap:
     a. descriptor = realm.moduleMap[specifier]
     b. module = CreateModuleFromDescriptor(realm, descriptor, specifier)
     c. Add to realm.modules
     d. Return module

  3. If realm.loadNowHook is defined:
     a. descriptor = realm.loadNowHook(specifier)  // SYNCHRONOUS
     b. module = CreateModuleFromDescriptor(realm, descriptor, specifier)
     c. Add to realm.modules
     d. Return module

  4. Throw Error("Module not found: " + specifier)
```

### 4.5 Algorithm: Create Module from Descriptor

```
CreateModuleFromDescriptor(realm, descriptor, specifier):
  1. If descriptor has "source" property:
     a. If source is string:
        i. Parse as module source
        ii. Create ModuleInstance with parsed code
     b. Else if source is ModuleSource:
        i. Create ModuleInstance from ModuleSource
     c. Else if source is VirtualModuleSource (object with execute):
        i. Create ModuleInstance with virtual bindings
        ii. Store execute function

  2. Else if descriptor has "namespace" property:
     a. If namespace is string:
        i. compartment = descriptor.compartment ?? currentCompartment
        ii. Create alias to compartment's module[namespace]
     b. Else if namespace is ModuleExportsNamespace:
        i. Create module with that namespace
     c. Else (plain object):
        i. Create virtual module namespace from object properties

  3. Set module.importMeta from descriptor.importMeta if present
  4. Set referrer specifier from descriptor.specifier if present
  5. Return module
```

---

## 5. Module Loading System

### 5.1 Module Lifecycle

```
                    ┌─────────┐
                    │   NEW   │
                    └────┬────┘
                         │ loadHook / loadNowHook
                    ┌────▼────┐
                    │ LOADING │
                    └────┬────┘
                         │ source received
                    ┌────▼────┐
                    │ LOADED  │
                    └────┬────┘
                         │ resolve dependencies
                    ┌────▼────┐
              ┌────▶│ LINKING │◀────┐
              │     └────┬────┘     │
              │          │          │
              │     ┌────▼────┐     │
              │     │ LINKED  │     │
              │     └────┬────┘     │
              │          │ execute  │
              │     ┌────▼─────┐    │
              │     │EXECUTING │    │
              │     └────┬─────┘    │
              │          │          │
         ┌────┴────┐     │     ┌────┴───┐
         │  ERROR  │◀────┴────▶│EXECUTED│
         └─────────┘           └────────┘
```

### 5.2 Circular Dependencies

Handle circular dependencies the same as standard ES modules:
- During linking, create module namespace objects with uninitialized bindings
- During execution, bindings are initialized in evaluation order
- Accessing uninitialized bindings throws ReferenceError

### 5.3 Error Propagation

- If a module throws during execution, cache the error
- Subsequent imports of the same module re-throw the cached error
- Each compartment maintains separate error states for the same logical module

### 5.4 Shared vs Separate Modules

**Shared Modules** (same namespace across compartments):
```javascript
const c1 = new Compartment({ modules: { foo: { source: fooSource } } });
const c2 = new Compartment({ modules: {
  foo: { namespace: "foo", compartment: c1 }  // Share c1's foo
}});
// c1.importNow("foo") === c2.importNow("foo")  // Same object
```

**Separate Modules** (different instances):
```javascript
const c1 = new Compartment({ modules: { foo: { source: fooSource } } });
const c2 = new Compartment({ modules: { foo: { source: fooSource } } });
// c1.importNow("foo") !== c2.importNow("foo")  // Different objects
```

---

## 6. Test Suite

The following tests should be implemented to verify Compartment functionality. Tests are categorized by feature area.

### 6.1 Constructor Tests

#### Test: Constructor Options Type Validation
```javascript
// options must be object or undefined
assert.throws(TypeError, () => new Compartment(null));
assert.throws(TypeError, () => new Compartment(42));
assert.throws(TypeError, () => new Compartment("string"));
new Compartment();  // OK
new Compartment({});  // OK
new Compartment([]);  // OK (arrays are objects)
```

#### Test: globals Option
```javascript
const c = new Compartment({
  globals: { x: 1, y: 2 }
});
assert.sameValue(c.globalThis.x, 1);
assert.sameValue(c.globalThis.y, 2);
assert.sameValue(c.evaluate("x + y"), 3);
```

#### Test: globalLexicals Option
```javascript
const c = new Compartment({
  globals: { foo: 0 },
  globalLexicals: { bar: 0 }
});

c.evaluate("bar = foo++");
assert.sameValue(c.globalThis.foo, 1);  // Modified via global
assert.sameValue(c.globalThis.bar, undefined);  // NOT on globalThis
assert.sameValue(c.evaluate("bar"), 0);  // Lexical scope maintained
```

#### Test: globalLexicals Creates let/const Based on Writable
```javascript
const globalLexicals = Object.create(null, {
  mutable: { enumerable: true, writable: true, value: 1 },
  immutable: { enumerable: true, writable: false, value: 2 }
});
const c = new Compartment({ globalLexicals });

c.evaluate("mutable = 10");  // OK - let binding
assert.throws(TypeError, () => c.evaluate("immutable = 20"));  // const binding
```

#### Test: modules Option
```javascript
const source = new ModuleSource(`export default 42`);
const c = new Compartment({
  modules: { answer: { source } }
});
const ns = c.importNow("answer");
assert.sameValue(ns.default, 42);
```

#### Test: Hook Type Validation
```javascript
// Hooks must be functions
assert.throws(TypeError, () => new Compartment({ resolveHook: {} }));
assert.throws(TypeError, () => new Compartment({ loadHook: "string" }));
assert.throws(TypeError, () => new Compartment({ loadNowHook: 42 }));
new Compartment({ resolveHook: () => {} });  // OK
```

### 6.2 globalThis Tests

#### Test: Separate globalThis Objects
```javascript
const c1 = new Compartment();
const c2 = new Compartment();
assert.notSameValue(c1.globalThis, c2.globalThis);
assert.notSameValue(c1.globalThis, globalThis);
```

#### Test: Built-ins Present on globalThis
```javascript
const c = new Compartment();
assert.sameValue(typeof c.globalThis.Array, "function");
assert.sameValue(typeof c.globalThis.Object, "function");
assert.sameValue(typeof c.globalThis.JSON, "object");
```

#### Test: Compartment-Specific eval and Function
```javascript
const c = new Compartment({ globals: { x: 42 } });
assert.notSameValue(c.globalThis.eval, eval);
assert.notSameValue(c.globalThis.Function, Function);
// eval uses compartment's scope
assert.sameValue(c.evaluate("eval('x')"), 42);
```

### 6.3 evaluate() Tests

#### Test: Basic Evaluation
```javascript
const c = new Compartment();
assert.sameValue(c.evaluate("1 + 2"), 3);
assert.sameValue(c.evaluate("'hello'"), "hello");
```

#### Test: Strict Mode Enforcement
```javascript
const c = new Compartment();
// Strict mode is always on
assert.throws(SyntaxError, () => c.evaluate("with({}) {}"));
```

#### Test: this is globalThis
```javascript
const c = new Compartment();
assert.sameValue(c.evaluate("this"), c.globalThis);
```

#### Test: Global Variable Access
```javascript
const c = new Compartment({ globals: { x: 1 } });
c.evaluate("var y = x + 1");
assert.sameValue(c.globalThis.y, 2);
```

### 6.4 import() Tests (Async)

#### Test: Basic Async Import
```javascript
const c = new Compartment({
  resolveHook: (s) => s,
  loadHook: (specifier) => ({
    source: new ModuleSource(`export default "loaded"`)
  })
});

c.import("test").then(ns => {
  assert.sameValue(ns.default, "loaded");
}).then($DONE, $DONE);
```

#### Test: Import with Dependencies
```javascript
const sources = {
  foo: `export default "foo"`,
  bar: `import foo from "foo"; export default foo + "bar"`
};
const c = new Compartment({
  resolveHook: (s) => s,
  loadHook: (specifier) => ({
    source: new ModuleSource(sources[specifier])
  })
});

c.import("bar").then(ns => {
  assert.sameValue(ns.default, "foobar");
}).then($DONE, $DONE);
```

#### Test: Module Caching
```javascript
let loadCount = 0;
const c = new Compartment({
  resolveHook: (s) => s,
  loadHook: (specifier) => {
    loadCount++;
    return { source: new ModuleSource(`export default ${loadCount}`) };
  }
});

Promise.all([c.import("mod"), c.import("mod")]).then(([ns1, ns2]) => {
  assert.sameValue(ns1, ns2);  // Same namespace object
  assert.sameValue(loadCount, 1);  // Only loaded once
}).then($DONE, $DONE);
```

### 6.5 importNow() Tests (Sync)

#### Test: Basic Sync Import
```javascript
const c = new Compartment({
  modules: {
    test: { source: new ModuleSource(`export default 42`) }
  }
});
const ns = c.importNow("test");
assert.sameValue(ns.default, 42);
```

#### Test: loadNowHook Usage
```javascript
const c = new Compartment({
  resolveHook: (s) => s,
  loadNowHook: (specifier) => ({
    source: new ModuleSource(`export default "${specifier}"`)
  })
});
const ns = c.importNow("dynamic");
assert.sameValue(ns.default, "dynamic");
```

#### Test: Throws on Top-Level Await
```javascript
const c = new Compartment({
  modules: {
    async: { source: new ModuleSource(`await Promise.resolve(); export default 1`) }
  }
});
assert.throws(TypeError, () => c.importNow("async"));
```

### 6.6 ModuleSource Tests

#### Test: ModuleSource Construction
```javascript
const source = new ModuleSource(`export default 42`);
assert.sameValue(Object.prototype.toString.call(source), "[object ModuleSource]");
```

#### Test: bindings Property
```javascript
const source = new ModuleSource(`
  export var x;
  export default 0;
  export { x as y };
  import a from "mod";
  import { b } from "mod";
  import * as ns from "mod";
  export { c } from "mod";
  export * from "mod";
  export * as ns2 from "mod";
`);

const bindings = source.bindings;
assert(Array.isArray(bindings));

// Verify binding shapes
assert(bindings.some(b => b.export === "x"));
assert(bindings.some(b => b.export === "default"));
assert(bindings.some(b => b.export === "x" && b.as === "y"));
assert(bindings.some(b => b.import === "default" && b.as === "a" && b.from === "mod"));
assert(bindings.some(b => b.import === "b" && b.from === "mod"));
assert(bindings.some(b => b.importAllFrom === "mod" && b.as === "ns"));
assert(bindings.some(b => b.export === "c" && b.from === "mod"));
assert(bindings.some(b => b.exportAllFrom === "mod"));
assert(bindings.some(b => b.exportAllFrom === "mod" && b.as === "ns2"));
```

#### Test: needsImport Property
```javascript
const static = new ModuleSource(`import x from "mod"`);
assert.sameValue(static.needsImport, false);

const dynamic = new ModuleSource(`const x = await import("mod")`);
assert.sameValue(dynamic.needsImport, true);
```

#### Test: needsImportMeta Property
```javascript
const noMeta = new ModuleSource(`export default 1`);
assert.sameValue(noMeta.needsImportMeta, false);

const usesMeta = new ModuleSource(`export default import.meta.url`);
assert.sameValue(usesMeta.needsImportMeta, true);
```

### 6.7 VirtualModuleSource Tests

#### Test: Basic Virtual Module
```javascript
const virtual = {
  bindings: [{ export: "default" }],
  execute($) {
    $.default = 42;
  }
};

const c = new Compartment({
  modules: { test: { source: virtual } }
});
const ns = c.importNow("test");
assert.sameValue(ns.default, 42);
```

#### Test: Import Parameter
```javascript
const virtual = {
  needsImport: true,
  execute($, Import, ImportMeta) {
    assert.sameValue(typeof Import, "function");
  }
};

const noImport = {
  needsImport: false,
  execute($, Import, ImportMeta) {
    assert.sameValue(Import, undefined);
  }
};
```

#### Test: ImportMeta Parameter
```javascript
const virtual = {
  needsImportMeta: true,
  execute($, Import, ImportMeta) {
    assert.sameValue(typeof ImportMeta, "object");
  }
};
```

#### Test: Binding Constraints
```javascript
const foo = new ModuleSource(`export let x = 1`);
const bar = {
  bindings: [
    { import: "x", from: "foo" },
    { export: "y" }
  ],
  execute($) {
    // Import bindings are read-only
    assert.throws(TypeError, () => { $.x = 2; });
    // Export bindings are writable
    $.y = 10;  // OK
  }
};
```

### 6.8 Namespace Sharing Tests

#### Test: Shared Namespace Between Compartments
```javascript
const source = new ModuleSource(`
  export default "foo";
  let count = 0;
  export function increment() { return ++count; }
`);

const c1 = new Compartment({
  resolveHook: s => s,
  modules: { mod: { source } }
});

const c2 = new Compartment({
  modules: { mod: { namespace: "mod", compartment: c1 } }
});

const ns1 = c1.importNow("mod");
const ns2 = c2.importNow("mod");

assert.sameValue(ns1, ns2);  // Same object
assert.sameValue(ns1.increment(), 1);
assert.sameValue(ns2.increment(), 2);  // Shared state
```

#### Test: Separate Namespaces
```javascript
const source = new ModuleSource(`let count = 0; export function inc() { return ++count; }`);

const c1 = new Compartment({ modules: { mod: { source } } });
const c2 = new Compartment({ modules: { mod: { source } } });

const ns1 = c1.importNow("mod");
const ns2 = c2.importNow("mod");

assert.notSameValue(ns1, ns2);
assert.sameValue(ns1.inc(), 1);
assert.sameValue(ns2.inc(), 1);  // Independent counters
```

### 6.9 Error Handling Tests

#### Test: Module Execution Error Caching
```javascript
let errorCount = 0;
const source = new ModuleSource(`
  throw new Error("module error " + (++globalThis.errorCount || 1));
`);

const c = new Compartment({ modules: { bad: { source } } });
c.globalThis.errorCount = 0;

let error1, error2;
try { c.importNow("bad"); } catch(e) { error1 = e; }
try { c.importNow("bad"); } catch(e) { error2 = e; }

assert.sameValue(error1, error2);  // Same error object cached
```

#### Test: Separate Error Instances Per Compartment
```javascript
const source = new ModuleSource(`throw new Error("fail")`);

const c1 = new Compartment({ resolveHook: s => s, loadNowHook: () => ({ source }) });
const c2 = new Compartment({ resolveHook: s => s, loadNowHook: () => ({ source }) });

let e1, e2;
try { c1.importNow("bad"); } catch(e) { e1 = e; }
try { c2.importNow("bad"); } catch(e) { e2 = e; }

assert.notSameValue(e1, e2);  // Different error instances
```

### 6.10 resolveHook Tests

#### Test: resolveHook Called with Correct Arguments
```javascript
const calls = [];
const c = new Compartment({
  resolveHook(importSpecifier, referrerSpecifier) {
    calls.push({ importSpecifier, referrerSpecifier });
    return importSpecifier.toUpperCase();
  },
  modules: {
    MAIN: { source: new ModuleSource(`import "dep"`) },
    DEP: { source: new ModuleSource(`export default 1`) }
  }
});

c.importNow("main");
assert.sameValue(calls.length, 2);
assert.sameValue(calls[0].importSpecifier, "main");
assert.sameValue(calls[1].importSpecifier, "dep");
assert.sameValue(calls[1].referrerSpecifier, "MAIN");
```

### 6.11 importMeta Tests

#### Test: importMeta Object from Descriptor
```javascript
const c = new Compartment({
  modules: {
    test: {
      source: new ModuleSource(`export default import.meta`),
      importMeta: { url: "test://module", custom: 42 }
    }
  }
});

const ns = c.importNow("test");
assert.sameValue(ns.default.url, "test://module");
assert.sameValue(ns.default.custom, 42);
```

### 6.12 Attenuation Tests

#### Test: Child Compartment Created from Parent
```javascript
const parent = new Compartment({
  globals: { allowed: true }
});

parent.evaluate(`
  const child = new Compartment({
    globals: { inherited: allowed }
  });
  globalThis.child = child;
`);

assert.sameValue(parent.globalThis.child.evaluate("inherited"), true);
```

#### Test: Child Cannot Access Parent Globals Directly
```javascript
const parent = new Compartment({
  globals: { secret: "hidden" }
});

parent.evaluate(`
  const child = new Compartment();
  globalThis.childResult = child.evaluate("typeof secret");
`);

assert.sameValue(parent.globalThis.childResult, "undefined");
```

---

## 7. Implementation Checklist

Use this checklist to track implementation progress:

### Phase 1: Core Infrastructure
- [ ] Define Compartment internal slots structure
- [ ] Define Realm internal slots structure
- [ ] Define Module internal slots structure
- [ ] Implement module status tracking
- [ ] Implement module map data structure

### Phase 2: Compartment Constructor
- [ ] Basic Compartment construction
- [ ] Process `globals` option
- [ ] Process `globalLexicals` option (let/const based on writable)
- [ ] Process `modules` option
- [ ] Store `resolveHook`
- [ ] Store `loadHook`
- [ ] Store `loadNowHook`
- [ ] Validate option types

### Phase 3: globalThis
- [ ] Implement Compartment.prototype.globalThis getter
- [ ] Ensure isolated global objects per compartment
- [ ] Ensure built-ins are present
- [ ] Ensure Compartment/eval/Function are compartment-specific

### Phase 4: evaluate()
- [ ] Parse source as Script
- [ ] Enforce strict mode
- [ ] Execute with compartment's globalThis as this
- [ ] Execute with compartment's global lexical scope
- [ ] Return completion value

### Phase 5: Module Resolution
- [ ] Implement resolveHook invocation
- [ ] Implement parent realm fallback for resolution
- [ ] Handle default resolution if no hook

### Phase 6: Module Loading (Async)
- [ ] Implement import() method
- [ ] Implement loadHook invocation
- [ ] Implement module map lookup
- [ ] Implement dependency resolution and loading
- [ ] Implement module linking
- [ ] Implement module execution
- [ ] Implement promise fulfillment

### Phase 7: Module Loading (Sync)
- [ ] Implement importNow() method
- [ ] Implement loadNowHook invocation
- [ ] Detect and throw on top-level await
- [ ] Ensure synchronous completion

### Phase 8: ModuleSource
- [ ] Parse source as Module
- [ ] Implement bindings getter
- [ ] Implement needsImport getter
- [ ] Implement needsImportMeta getter
- [ ] Handle JSON modules

### Phase 9: VirtualModuleSource
- [ ] Process bindings array
- [ ] Implement execute() invocation
- [ ] Implement $ (environment record) parameter
- [ ] Implement Import parameter
- [ ] Implement ImportMeta parameter
- [ ] Enforce binding constraints

### Phase 10: Module Descriptors
- [ ] Handle `{ source: ModuleSource }` descriptors
- [ ] Handle `{ source: string }` descriptors (parent parses)
- [ ] Handle `{ source: VirtualModuleSource }` descriptors
- [ ] Handle `{ namespace: string, compartment? }` descriptors
- [ ] Handle `{ namespace: ModuleExportsNamespace }` descriptors
- [ ] Handle `{ namespace: Object }` (virtual namespace)
- [ ] Handle importMeta from descriptors
- [ ] Handle specifier from descriptors

### Phase 11: Error Handling
- [ ] Cache module execution errors
- [ ] Ensure separate error instances per compartment
- [ ] Propagate errors through import chains
- [ ] Handle hook errors

### Phase 12: Advanced Features
- [ ] Implement module namespace sharing
- [ ] Implement attenuation (child compartments)
- [ ] Implement circular dependency handling
- [ ] Implement concurrent import coalescing

---

## Appendix A: Key Implementation Files in Moddable XS

For reference, here are the key files in the Moddable XS implementation:

| Feature | File | Key Functions/Lines |
|---------|------|---------------------|
| Compartment Constructor | xs/sources/xsModule.c | `fx_Compartment` (lines 2866-3152) |
| evaluate() | xs/sources/xsModule.c | `fx_Compartment_prototype_evaluate` (lines 3163-3175) |
| import() | xs/sources/xsModule.c | `fx_Compartment_prototype_import` (lines 3177-3191) |
| importNow() | xs/sources/xsModule.c | `fx_Compartment_prototype_importNow` (lines 3193-3207) |
| globalThis getter | xs/sources/xsModule.c | `fx_Compartment_prototype_get_globalThis` (lines 3154-3161) |
| ModuleSource Constructor | xs/sources/xsModule.c | `fx_ModuleSource` (lines 3267-3302) |
| Module Bindings | xs/sources/xsModule.c | `fx_ModuleSource_prototype_get_bindings` (lines 3304-3429) |
| resolveHook | xs/sources/xsModule.c | `fxResolveSpecifier` (lines 2144-2194) |
| Async Import | xs/sources/xsModule.c | `fxRunImport` (lines 2205-2266) |
| Sync Import | xs/sources/xsModule.c | `fxRunImportNow` (lines 2463-2585) |
| Realm Creation | xs/sources/xsType.c | `fxNewRealmInstance` (lines 1472-1512) |
| Realm Macros | xs/sources/xsAll.h | lines 2538-2548 |
| Module Macros | xs/sources/xsAll.h | lines 2550-2560 |
| Module Status | xs/sources/xsModule.c | enum at lines 129-138 |

---

## Appendix B: TC39 Proposal References

- **Main Proposal**: https://github.com/tc39/proposal-compartments
- **Compartment API Spec**: https://github.com/tc39/proposal-compartments/blob/master/4-compartment.md
- **Moddable XS Documentation**: https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/xs/XS%20Compartment.md

---

## Appendix C: Test File Locations in Moddable

All Compartment tests are located under:
```
tests/xs/built-ins/Compartment/
├── constructor/
│   ├── options-type.js
│   ├── modules-types.js
│   ├── modules-properties.js
│   ├── hooks-types.js
│   ├── globals-types.js
│   ├── globals-properties.js
│   ├── globalLexicals-types.js
│   ├── globalLexicals-properties.js
│   └── resolveHook.js
├── descriptors/
│   ├── source/specifier.js
│   ├── source/parent.js
│   └── namespace/object.js
├── prototype/
│   ├── evaluate/environments.js
│   ├── import/*.js (16 files)
│   ├── importNow/*.js (14 files)
│   ├── globalThis/defaults.js
│   └── Symbol.toStringTag.js
├── ModuleSource/
│   ├── bindings/test.js, name.js
│   ├── needsImport/test.js, name.js
│   └── needsImportMeta/test.js, name.js
└── VirtualModuleSource/
    ├── bindings/test.js, environment.js
    ├── needsImport/test.js
    └── needsImportMeta/test.js
```

Example usage tests:
```
examples/js/compartments/
├── shared-modules/
├── separate-modules/
├── shared-globals/
├── separate-globals/
├── evaluate/
└── variations/
```

---

*This document was generated from analysis of the Moddable XS JavaScript engine implementation and the TC39 Compartments proposal.*
