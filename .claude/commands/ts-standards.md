---
description: |
  TypeScript standards for this project (BE Express + FE Angular).

  TRIGGER — apply BEFORE writing or editing any .ts or .html file in this project.
  Auto-invoke when: the user asks to write, create, or modify TypeScript code or Angular templates (.ts, .html files). Do NOT apply to configuration files (tsconfig, eslint.config, vitest.config) or test files (*.spec.ts, *.test.ts) where rules may be relaxed for mocking purposes.
---

# TypeScript Standards — Satellites (BE + FE)

These rules apply to **all TypeScript and Angular HTML code** in the project, both in `satellites-be/src/` and `satellites-fe/src/`. Run through each rule mentally before writing or editing any code.

---

## 1. Zero `any` — always use the correct type

- **Never** write `: any`, `as any`, or `<any>`.
- If a third-party library type is not immediately available, look for it with `grep` or by reading the relevant `.d.ts` files in `node_modules`.
- If the type genuinely does not exist, **create it**: a proper `interface` or `type` that models what is known.
- When a type is truly unknown at compile time, use `unknown` with narrowing (type guards), never `any`.
- If a type is too complex to model precisely, use `Record<string, unknown>` or a partial structured type before resorting to `any`.

```ts
// ✗ BAD
function handler(event: any) { ... }
const entity = viewer.entities.add(opts) as any;

// ✓ GOOD
function handler(event: MouseEvent) { ... }
const entity: Entity = viewer.entities.add(opts);
```

---

## 2. No hardcoded strings — use Enums

- **Before writing any string literal** in a `.ts` or `.html` file, ask: does an enum for this already exist?
- First search the project's `*.enum.ts` files with `grep` or `find`.
- If no suitable enum exists and the string repeats or represents a domain value (state, route, entity name, config key, event type), **create an enum**.
- Pure UI strings (user-facing labels, display text, log messages) may remain as literals, but strings that drive logic **never** should.

```ts
// ✗ BAD
if (currentMode() === 'tracker') { ... }
viewer.entities.add({ id: 'starlink-laser-ahead', ... });

// ✓ GOOD
if (currentMode() === AppMode.Tracker) { ... }
viewer.entities.add({ id: EntityId.StarlinkLaserAhead, ... });
```

```html
<!-- ✗ BAD -->
<button [class.active]="mode === 'census'">...</button>

<!-- ✓ GOOD -->
<button [class.active]="mode === AppMode.Census">...</button>
```

---

## 3. Interfaces, Types, and Enums always in separate files

- **Never** define an `interface`, `type`, or `enum` inline inside a logic file or component.
- Required file structure:
  - `*.model.ts` — domain interfaces and types (data shapes, DTOs, API responses)
  - `*.enum.ts` — domain enums
  - `*.types.ts` — utility types, unions, mapped types that don't fit in a model file
- Model/enum files are imported, never redefined. If a type already exists elsewhere, **import it**.
- In the BE, shared types live in `src/types/`. In the FE, in `src/app/core/models/` and `src/app/core/enums/` (per the Phase 2 structure).

```ts
// ✗ BAD — defined inline inside the component
interface PassFilter { days: number; minEl: number; }

// ✓ GOOD — imported from its own file
import { PassFilter } from '../satellite.model';
```

---

## 4. No `as` type assertions — use type guards and narrowing

- **Avoid** `value as Type` except in strictly necessary cases (interop with Cesium or WASM where types are genuinely opaque — always document why with a comment).
- Instead of `as`, use:
  - **Type guards** (`instanceof`, `typeof`, predicate functions with `is`)
  - **Narrowing** via `if`, `switch`, discriminated unions
  - **`satisfies`** to verify a value meets a type without losing its inferred type
  - **`as const`** for readonly literals and objects

```ts
// ✗ BAD
const obs = this.viewer.entities.getById(id) as Entity;

// ✓ GOOD
const obs = this.viewer.entities.getById(id);
if (!obs) return;
// obs is Entity here via narrowing

// ✓ GOOD — satisfies
const config = { level: 'info', pretty: true } satisfies LogConfig;
```

---

## 5. DRY — do not repeat code

- Before writing a function or logic block, search for something similar already in the project.
- If the same pattern appears ≥ 2 times, extract it:
  - In the BE: to a helper in `src/utils/` or the relevant service
  - In the FE: to a service method, a pipe, or a `shared/` component
- In Angular templates: if the same markup repeats ≥ 2 times with varying data, turn it into a component.
- **Never** duplicate types: if `SatelliteApiResponse` already exists in the FE, do not create `SatelliteData` with the same fields.

---

## 6. Additional quality rules

### Immutability by default
- Use `readonly` on interface properties that should not mutate.
- Use `as const` for static configuration objects and arrays.
- Prefer `const` over `let`; never use `var`.

### Strict null safety
- Never use the `!` non-null assertion operator unless there is an externally guaranteed invariant — document it with a comment if so.
- Use optional chaining `?.` and nullish coalescing `??` before reaching for `!`.

```ts
// ✗ BAD
const name = satellite!.name;

// ✓ GOOD
const name = satellite?.name ?? 'Unknown';
```

### Explicit return types on public functions
- All exported functions and public class/service methods must declare their return type explicitly.
- Private and internal functions may rely on inference.

### Discriminated unions for state modeling
- Model states with discriminated unions instead of loose boolean flags.

```ts
// ✗ BAD
interface State { loading: boolean; error: string | null; data: T | null; }

// ✓ GOOD
type State<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T };
```

### Generics over duplication
- If a function or type exists for a specific type but the logic is identical for another, make it generic rather than duplicating it.

---

## Pre-write checklist

Before writing or modifying any `.ts` or `.html` file, verify mentally:

- [ ] Did I write `any` anywhere? → find the correct type or create it
- [ ] Are there strings driving logic? → convert them to an enum
- [ ] Did I define a type/interface/enum inside a component or logic file? → move it to its `.model.ts` / `.enum.ts`
- [ ] Did I use `as Type`? → replace with a type guard or narrowing
- [ ] Does this code already exist elsewhere? → extract or import it
- [ ] Did I use `!` to force non-null? → use `?.` and `??` instead
- [ ] Do exported functions have explicit return types?
- [ ] Is state modeled with loose booleans? → consider a discriminated union
