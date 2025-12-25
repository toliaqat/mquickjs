# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MicroQuickJS (MQuickJS) is a JavaScript engine for embedded systems, requiring as little as 10 kB RAM and ~100 kB ROM. Based on QuickJS but with different internals: tracing/compacting garbage collector, UTF-8 string storage, no malloc/free dependency.

## Design Philosophy

When implementing new features, keep these core principles in mind:

### 1. Minimal Footprint First
- Target: 10 kB RAM, 100 kB ROM (ARM Thumb-2)
- Every byte counts - question whether each feature justifies its memory cost
- Prefer smaller code over faster code when there's a tradeoff

### 2. Zero External Dependencies
- No malloc/free - engine uses only a provided memory buffer
- No libc math - custom `libm.c` implementation
- No printf - minimal C library dependency
- This enables bare-metal embedded deployment

### 3. ROM-Friendly Design
- Standard library compiles to C structures that live in ROM
- Bytecode can execute directly from ROM after relocation
- Properties can reside in ROM for stdlib objects
- Fast instantiation with minimal RAM allocation

### 4. Stricter JavaScript Subset
- Remove error-prone features, not add complexity to support them
- The subset must still be valid JavaScript (runs in other engines)
- No array holes, no direct eval, no value boxing, no `with`
- Prefer throwing errors over silent misbehavior

### 5. Memory Model Constraints
- Tracing + compacting GC (not reference counting)
- Object addresses can move on any allocation
- Word-sized values (32-bit on 32-bit CPU)
- No fragmentation - compaction keeps memory tight

### 6. Bounded Resource Usage
- Parser avoids recursion - bounded C stack usage
- VM does not use CPU stack
- One-pass compilation - no AST, no multi-pass optimization
- Predictable memory behavior for embedded systems

### 7. Implementation Guidelines
- C functions stored as single values when possible (no property overhead)
- Strings stored as UTF-8 (not 8/16-bit arrays)
- Property keys are internalized (unique) strings
- Compress debug info (exponential-Golomb codes for line/column)
- Support cross-compilation (ARM32, x86_32, soft float)

## Build Commands

```bash
make              # Build mqjs (REPL) and example - RUN THIS FIRST
make test         # Run basic tests (closure, language, loop, builtin)
make microbench   # Run QuickJS microbenchmark
make octane       # Run V8 octane benchmark (requires mquickjs-extras)
make clean        # Clean build artifacts
```

Note: You must run `make` before using `./mqjs` or running individual tests.

Build configuration options (uncomment in Makefile):
- `CONFIG_ASAN=y` - Enable AddressSanitizer for debugging
- `CONFIG_X86_32=y` - 32-bit x86 build
- `CONFIG_ARM32=y` - ARM32 cross-compilation
- `CONFIG_SOFTFLOAT=y` - Software floating point emulation

## Running the REPL

```bash
./mqjs                           # Interactive REPL
./mqjs tests/test_language.js    # Run a script
./mqjs --memory-limit 10k file.js  # Run with memory limit
./mqjs -o out.bin file.js        # Compile to bytecode
./mqjs out.bin                   # Run bytecode
```

## Architecture

### Core Files
- `mquickjs.c` (18k lines) - Main engine: parser, bytecode compiler, VM, GC, builtins
- `mquickjs.h` - Public C API
- `mquickjs_priv.h` - Private definitions
- `mquickjs_opcode.h` - Bytecode opcodes
- `libm.c` - Custom math library (no libc dependency)
- `dtoa.c` - Double-to-ASCII conversion
- `cutils.c/h` - Utilities (bit ops, UTF-8, strings)

### Build Tools
- `mquickjs_build.c` - Compiles stdlib to ROM-able C structures
- `mqjs_stdlib.c` - Stdlib definition for mqjs
- `mqjs_stdlib` tool generates `mqjs_stdlib.h` and `mquickjs_atom.h`

### Value Representation
CPU word-sized tagged values:
- 31-bit integers (1-bit tag)
- Single unicode codepoints
- Short floats (64-bit CPUs only)
- Pointers to memory blocks (tag stored in memory)

### Memory Model
- Tracing + compacting GC (not reference counting)
- No `JS_FreeValue()` needed
- Object addresses can move on any JS allocation
- Use `JSGCRef` + `JS_PushGCRef()`/`JS_PopGCRef()` to hold values across allocations
- `DEBUG_GC` define forces object movement on every allocation (for testing)

### C API Pattern
```c
JSContext *ctx;
uint8_t mem_buf[8192];
ctx = JS_NewContext(mem_buf, sizeof(mem_buf), &js_stdlib);
// ... use ctx ...
JS_FreeContext(ctx);  // Only needed to call finalizers
```

Key types: `JSContext`, `JSValue`, `JSGCRef`

## JavaScript Subset

Strict mode only (ES5 subset with extensions):
- No `with`, no direct `eval`, no value boxing (`new Number()`)
- No array holes - writing past end is TypeError
- `for...in` iterates own properties only
- `for...of` works on arrays only
- Typed arrays supported
- RegExp: dotall/sticky/unicode flags work, but unicode properties unsupported
- Date: only `Date.now()` supported
- String case functions: ASCII only

## Security Features (SES/Hardened JavaScript)

MQuickJS implements core security primitives from Hardened JavaScript (SES):

### Object Immutability
- `Object.freeze(obj)` - Make object and its properties immutable
- `Object.seal(obj)` - Prevent adding/removing properties
- `Object.preventExtensions(obj)` - Prevent adding new properties
- `Object.isFrozen/isSealed/isExtensible(obj)` - Check object state

### harden(obj)
Transitively freezes an object and all objects reachable from it:
```javascript
var api = harden({
    greet: function(name) { return "Hello, " + name; },
    config: { version: "1.0" }
});
// api, api.greet, and api.config are all now frozen
```

### lockdown()
Freezes all JavaScript intrinsics to prevent prototype pollution attacks:
```javascript
lockdown();  // Call once at startup

// Now these throw TypeError:
Object.prototype.evil = function() {};  // Cannot modify
Array.prototype.push = null;            // Cannot modify
```

Key behaviors:
- Can only be called once per context (throws TypeError on second call)
- Affects all Compartments (they share intrinsics)
- User-created objects remain mutable after lockdown
- Normal code continues to work (creating objects, arrays, using methods)

### Compartments
Isolated JavaScript execution environments with shared intrinsics:
```javascript
var c = new Compartment({ globals: { x: 1 } });
c.evaluate("x + 1");  // 2
c.globalThis.x;       // 1
```

## Tests

Test files in `tests/`:
- `test_language.js` - Language feature tests
- `test_closure.js` - Closure tests
- `test_loop.js` - Loop construct tests
- `test_builtin.js` - Builtin function tests
- `test_compartment.js` - Compartment isolation tests
- `test_harden_lockdown.js` - Security primitives (freeze/seal/harden/lockdown)
- `test_rect.js` - C API example test
- `microbench.js` - Performance microbenchmarks
