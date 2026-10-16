# @fringeworks/event

`@fringeworks/event` is a library some will find handy, for simple event handling.\
On top of type-safe event registration and dispatching, it lets parents and children share an instance, suspends events and dispatches them later in bulk, and supports cancelable events.

**[日本語のREADMEはこちら](./README.ja.md)**

## Features

- Type-safe: each event name has its own detail type, and even when subscribing to multiple events at once, `type` narrows the detail.
- Shared instances: pass the parent's `EventDispatcher` to a child, and the parent's subscribers receive the child's events. You can expose it to the outside with a type that only allows subscribing.
- Relaying: relay a child's events to the parent as different events (`relay`).
- Suspension: temporarily stop dispatching, then choose whether suspended events are ignored, all dispatched, or only the last one dispatched.
- Cancellation: calling `preventDefault()` in a handler makes `dispatch` return `false`.
- Activation: run the source of events (such as DOM listeners) only while they are subscribed to.
- Works with standard APIs: unsubscribe with an `AbortSignal` and dispose with the `using` declaration.

## Installation

```sh
npm install @fringeworks/event
```

TypeScript 5.2 or later is required when using it with TypeScript.\
Disposing with the `using` declaration requires a runtime with `Symbol.dispose` or a polyfill. Calling `dispose()` directly does not.

## Usage

### Registering and dispatching events

Pass an event map (event names mapped to detail types) as the type argument. Use `void` for events with no data.

```ts
import { EventDispatcher } from '@fringeworks/event';

type TodoEvents = {
  add: { title: string };
  remove: { id: number };
  clear: void;
};

const events = new EventDispatcher<TodoEvents>();

const off = events.on('add', (event) => {
  console.log(event.type, event.detail.title);
});

events.dispatch('add', { title: 'Buy milk' });
events.dispatch('clear'); // detail can be omitted for void events

off(); // remove the handler
```

### Subscribing to multiple events

```ts
events.on(['add', 'remove'], (event) => {
  if (event.type === 'add') {
    event.detail.title; // { title: string }
  } else {
    event.detail.id; // { id: number }
  }
});
```

### Removing handlers

Besides calling the function returned by `on`, handlers can be removed in the following ways.

```ts
// Remove a specific handler
events.off('add', { handler });

// Remove all handlers of an owner
events.on('add', handler, { owner: this });
events.on('remove', handler2, { owner: this });
events.off({ owner: this }); // removes this's handlers from all events

// Remove all handlers of an event
events.off('add');

// Remove with an AbortSignal
const controller = new AbortController();
events.on('add', handler, { signal: controller.signal });
controller.abort();

// Call only once
events.on('add', handler, { once: true });
```

If the `handler` or `owner` passed to `off` is `null` / `undefined`, nothing is removed.

Handlers removed while `dispatch` is running are not called for the rest of that `dispatch` (the same applies to `dispose`). Handlers registered while `dispatch` is running are called from the next `dispatch`.

### Canceling events

```ts
type FormEvents = {
  beforeSubmit: { values: Record<string, string> };
};

const events = new EventDispatcher<FormEvents>();

events.on('beforeSubmit', (event) => {
  if (!event.detail.values.name) {
    event.preventDefault();
  }
});

if (events.dispatch('beforeSubmit', { values })) {
  submit(values);
}
```

Calling `event.stopImmediatePropagation()` prevents the remaining handlers from running.

### Suspending events

The mode decides what happens to events dispatched between `suspend` and `resume`.

| Mode               | Events dispatched while suspended                                      |
| ------------------ | ---------------------------------------------------------------------- |
| `ignore` (default) | Ignored                                                                |
| `queue`            | All kept and dispatched in order after resuming                        |
| `latest`           | Only the last one per event name is kept and dispatched after resuming |

```ts
events.suspend('latest');
events.dispatch('add', { title: 'A' });
events.dispatch('add', { title: 'B' });
events.resume(); // add is dispatched once, with { title: 'B' }
```

In `latest` mode, events are dispatched in the order each event name was last dispatched. For example, if `add` → `remove` → `add` are dispatched, they are dispatched as `remove` → `add` after resuming.

While the kept events are being dispatched, an event that a handler dispatches runs before the remaining kept events. Even if a handler calls `suspend`, all kept events are still dispatched (later `dispatch` calls are suspended).

`suspendDuring` suspends events only while a function runs. Events are resumed even if the function throws.

```ts
events.suspendDuring(() => {
  items.forEach((item) => collection.add(item));
}, 'latest');
```

`suspendDuring` accepts only synchronous functions; passing a function that returns a Promise is a type error. To suspend events during asynchronous work, wrap `suspend` and `resume` in `try` / `finally`.

```ts
events.suspend('latest');
try {
  await saveAll(items);
} finally {
  events.resume();
}
```

When `suspend` is nested, events stay suspended until `resume` has been called the same number of times, and the outermost mode is used.

### Sharing an instance between parent and child

When a parent passes its `EventDispatcher` to a child, the parent's subscribers receive the events the child dispatches.\
The child declares only the events it dispatches, and the parent can pass an instance that has more events.

Use the following types depending on the purpose.

| Type                     | What it allows                                      | Where to use it                           |
| ------------------------ | --------------------------------------------------- | ----------------------------------------- |
| `EventSubscribable<M>`   | Subscribing (`on` / `off`)                          | `events` exposed to the outside           |
| `EventDispatcherLike<M>` | Subscribing, dispatching, suspending (no `dispose`) | The type of the instance a child receives |
| `EventDispatcher<M>`     | Everything (including `dispose`)                    | Held only by the side that created it     |

```ts
import {
  EventDispatcher,
  type EventDispatcherLike,
  type EventSubscribable,
  type Evented,
} from '@fringeworks/event';

type ToolbarEvents = {
  click: { button: string };
};

type GridEvents = ToolbarEvents & {
  select: { row: number };
};

class Toolbar implements Evented<ToolbarEvents> {
  readonly events: EventSubscribable<ToolbarEvents>;
  private readonly dispatcher: EventDispatcherLike<ToolbarEvents>;

  constructor(dispatcher: EventDispatcherLike<ToolbarEvents>) {
    this.dispatcher = dispatcher;
    this.events = dispatcher;
  }

  click(button: string) {
    this.dispatcher.dispatch('click', { button });
  }
}

class Grid implements Evented<GridEvents> {
  private readonly dispatcher = new EventDispatcher<GridEvents>();
  readonly events: EventSubscribable<GridEvents> = this.dispatcher;
  readonly toolbar = new Toolbar(this.dispatcher);

  dispose() {
    this.dispatcher.dispose();
  }
}

const grid = new Grid();
grid.events.on('click', (event) => console.log(event.detail.button));
// grid.events.dispatch(...) and grid.events.dispose() are type errors
```

The receiving side (`Toolbar`) cannot call `dispose`, so it cannot accidentally remove all subscriptions of the parent and other children.\
To remove only the handlers it registered, the receiving side should pass `owner` when registering and use `off({ owner: this })`.

### Relaying a child's events as the parent's events

When the parent and the child each have their own `EventDispatcher` and you want to tell events with the same name apart (for example, both `change`), do not share the instance; instead, use `relay` to relay the child's events to the parent as different events.\
Since the detail can be recreated when relaying, you can add which child the event came from.

```ts
import {
  EventDispatcher,
  relay,
  type EventSubscribable,
  type Evented,
} from '@fringeworks/event';

type FieldEvents = {
  change: { value: string };
};

type RecordEvents = {
  change: { values: Record<string, string> };
  fieldChange: { field: DataField; value: string };
};

class DataField implements Evented<FieldEvents> {
  private readonly dispatcher = new EventDispatcher<FieldEvents>();
  readonly events: EventSubscribable<FieldEvents> = this.dispatcher;
}

class DataRecord implements Evented<RecordEvents> {
  private readonly dispatcher = new EventDispatcher<RecordEvents>();
  readonly events: EventSubscribable<RecordEvents> = this.dispatcher;
  private readonly fields = new Map<DataField, () => void>();

  add(field: DataField) {
    // calling the returned function stops relaying
    const off = relay(field.events, this.dispatcher, {
      change: {
        type: 'fieldChange',
        detail: (detail) => ({ field, ...detail }),
      },
    });
    this.fields.set(field, off);
  }

  remove(field: DataField) {
    this.fields.get(field)?.();
    this.fields.delete(field);
  }
}

record.events.on('change', ...); // changes of the record itself
record.events.on('fieldChange', (event) => event.detail.field); // changes of a field
```

When the detail can be passed as is, you can specify only the target event name.

```ts
relay(field.events, this.dispatcher, { change: 'fieldValueChange' });
```

- If `preventDefault()` is called on the target, `preventDefault()` is also called on the source event, and the source's `dispatch` returns `false`.
- Errors thrown by the target's handlers are thrown from the source's `dispatch`.
- If the target is suspended, its mode applies (`dispatch` returns `true` while suspended, so cancellation does not reach the source).
- The parent and child have independent lifetimes, so disposing a child does not affect the parent.

### Running work only while subscribed

Pass activation functions per event name to `activate` in the constructor. An activation function is called when the first handler of the event is registered, and the function it returns is called when the last handler is removed.\
Use it to run DOM listeners, `ResizeObserver` and the like only while the event is subscribed to.

```ts
type ViewportEvents = {
  resize: { width: number; height: number };
};

const getSize = () => ({ width: innerWidth, height: innerHeight });

const events = new EventDispatcher<ViewportEvents>({
  activate: {
    resize: ({ dispatch }) => {
      const listener = () => dispatch('resize', getSize());
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    },
  },
});

const off = events.on('resize', (event) => console.log(event.detail)); // starts watching window
off(); // stops watching window
```

- The activation function is called after the handler is registered. If it calls `dispatch`, the registered handler receives the event (for example, to pass an initial value).
- However the last handler is removed (`off`, the function returned by `on`, `signal`, `once` or `dispose`), the event is deactivated at that point. This also happens immediately when the handler is removed while `dispatch` is running.
- Registering again right after removing calls deactivation and activation in a row.
- `activate` can only be passed to the constructor, so children sharing the instance cannot change it.
- Use `hasHandlers(type)` to check whether an event is active.

### Disposing

```ts
events.dispose();

// The using declaration is also supported
{
  using events = new EventDispatcher<TodoEvents>();
  // disposed when leaving the scope
}
```

## API

### `EventDispatcher<M>`

| Method                          | Description                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `new EventDispatcher(options?)` | Creates an instance. `options` can specify activation functions                                                    |
| `on(type, handler, options?)`   | Registers a handler and returns a function that removes it. `type` can be an array. Duplicate handlers are ignored |
| `off(type, options?)`           | Removes handlers. Without `options`, removes all handlers of the event                                             |
| `off(options)`                  | Removes the given handler, or the handlers of the given owner, from all events                                     |
| `dispatch(type, detail?)`       | Dispatches an event. Returns `false` if `preventDefault()` was called (always `true` while suspended)              |
| `hasHandlers(type)`             | Returns whether any handler is registered for the event                                                            |
| `suspend(mode?)`                | Suspends dispatching                                                                                               |
| `resume()`                      | Resumes dispatching and dispatches the kept events                                                                 |
| `suspendDuring(fn, mode?)`      | Suspends only while the function runs and returns its result                                                       |
| `dispose()`                     | Removes all handlers and kept events, and resumes dispatching                                                      |

#### `constructor`

```ts
new EventDispatcher<M>(options?: EventDispatcherOptions<M>)
```

Creates an instance.

| Option      | Type                                        | Description                                                                                                                                        |
| ----------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activate?` | `{ [K in keyof M]?: EventActivator<M, K> }` | Activation functions per event name. Called when the first handler is registered; the returned function is called when the last handler is removed |

The activation function receives an object with the following properties.

| Property   | Type                    | Description                              |
| ---------- | ----------------------- | ---------------------------------------- |
| `type`     | `K`                     | The event name that became active        |
| `dispatch` | Same type as `dispatch` | Dispatches an event (same as `dispatch`) |

#### `on`

```ts
on<K extends keyof M>(
  type: K | readonly K[],
  handler: EventHandler<M, K>,
  options?: OnHandlerOptions,
): () => void
```

Registers a handler and returns a function that removes it. Registering the same handler for the same event twice is ignored.

| Parameter  | Type                 | Description                 |
| ---------- | -------------------- | --------------------------- |
| `type`     | `K \| readonly K[]`  | Event name. Can be an array |
| `handler`  | `EventHandler<M, K>` | Event handler               |
| `options?` | `OnHandlerOptions`   | The options below           |

| Option    | Type          | Description                                                                           |
| --------- | ------------- | ------------------------------------------------------------------------------------- |
| `owner?`  | `any`         | Owner of the handler. Use `off({ owner })` to remove all of them at once              |
| `once?`   | `boolean`     | Removes the handler after it is called once. With multiple event names, once in total |
| `signal?` | `AbortSignal` | Removes the handler when aborted                                                      |

#### `off`

```ts
off<K extends keyof M>(type: K | readonly K[], options?: OffHandlerOptions): void
off(options: OffHandlerOptions): void
```

Removes handlers.

| Parameter  | Type                                     | Description                                                                                                                                                                    |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `type`     | `K \| readonly K[]`                      | Event name. Can be an array. When omitted, all events are targeted                                                                                                             |
| `options?` | `{ handler: EventHandler } \| { owner }` | `handler` removes only that handler; `owner` removes the handlers of that owner. Can be omitted only when `type` is given, in which case all handlers of the event are removed |

#### `dispatch`

```ts
dispatch<K extends keyof M>(type: K, detail?: M[K]): boolean
```

Dispatches an event. Returns `false` if any handler called `preventDefault()`. Always returns `true` while suspended.

| Parameter | Type   | Description                                                            |
| --------- | ------ | ---------------------------------------------------------------------- |
| `type`    | `K`    | Event name                                                             |
| `detail?` | `M[K]` | Event data. Can be omitted only for events whose detail type is `void` |

#### `hasHandlers`

```ts
hasHandlers(type: keyof M): boolean
```

Returns whether any handler is registered for the event. Use it to skip dispatching when creating the detail is expensive. Whether dispatching is suspended is not taken into account.

```ts
if (events.hasHandlers('change')) {
  events.dispatch('change', createDetail());
}
```

#### `suspend`

```ts
suspend(mode?: SuspendMode): void
```

Suspends dispatching. `mode` decides what happens to events dispatched while suspended (default: `'ignore'`). See [Suspending events](#suspending-events) for the modes.\
When nested, events stay suspended until `resume` has been called the same number of times, and the outermost mode is used.

#### `resume`

```ts
resume(): void
```

Resumes dispatching. Once fully resumed, the kept events are dispatched in the order they were kept.

#### `suspendDuring`

```ts
suspendDuring<R>(fn: SyncFunction<R>, mode?: SuspendMode): R
```

Suspends dispatching only while `fn` runs, and returns its result. `fn` runs synchronously, and dispatching is resumed even if it throws. Passing a function that returns a Promise is a type error.\
If `fn` throws and handlers of the kept events also throw when resuming, the errors are combined into an `AggregateError` with the error of `fn` first.

#### `dispose`

```ts
dispose(): void
```

Removes all handlers and kept events, and resumes dispatching. Also calls the deactivation functions of all active events. Also called when leaving the scope of a `using` declaration.\
The instance can be used again by registering handlers with `on` after `dispose`.

#### The event passed to handlers

| Property                     | Type      | Description                                  |
| ---------------------------- | --------- | -------------------------------------------- |
| `type`                       | `K`       | Event name                                   |
| `detail`                     | `M[K]`    | Data passed to `dispatch`                    |
| `defaultPrevented`           | `boolean` | Whether `preventDefault()` has been called   |
| `preventDefault()`           | `void`    | Cancels the event                            |
| `stopImmediatePropagation()` | `void`    | Prevents the remaining handlers from running |

Only members with the same name and meaning as the standard `Event` are provided. Since there is no bubbling, there is no `stopPropagation()`, `target`, and so on.

#### Errors

If a handler throws, the remaining handlers still run. The error is thrown after all handlers have run; multiple errors are combined into an `AggregateError`.

When an error is thrown, `dispatch` does not return a value, so you cannot tell whether `preventDefault()` was called. Note that if you catch the error of a cancelable event and continue, you cannot determine whether it was canceled.

```ts
try {
  if (events.dispatch('beforeSubmit', { values })) {
    submit(values);
  }
} catch (error) {
  // Here, you cannot tell whether any handler called preventDefault()
}
```

Errors thrown by activation and deactivation functions are handled as follows.

| Where it is thrown                                                 | Handling                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Activation function                                                | Thrown from `on`. The registration is canceled, and events activated earlier by the same `on` are deactivated |
| Deactivation by `off`, the function returned by `on`, or `dispose` | Thrown after all handlers are removed                                                                         |
| Deactivation while `dispatch` is running (such as `once`)          | Thrown after all handlers have run, like handler errors                                                       |
| Deactivation by aborting `signal`                                  | Thrown inside the `AbortSignal` listener (reported to `window.onerror` and the like in browsers)              |

### `relay`

```ts
relay<S extends EventMap, T extends EventMap>(
  source: EventSubscribable<S>,
  target: EventDispatcherLike<T>,
  map: RelayMap<S, T>,
  options?: RelayOptions,
): () => void
```

Dispatches the source's events again as the target's events. Returns a function that stops relaying.\
If `preventDefault()` is called on the target, `preventDefault()` is also called on the source event.

| Parameter  | Type                     | Description                                          |
| ---------- | ------------------------ | ---------------------------------------------------- |
| `source`   | `EventSubscribable<S>`   | Source                                               |
| `target`   | `EventDispatcherLike<T>` | Target                                               |
| `map`      | `RelayMap<S, T>`         | The target for each source event name                |
| `options?` | `RelayOptions`           | The options below. Passed as is to the source's `on` |

Each value of `map` is one of the following.

| Value              | Description                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `'eventName'`      | The target event name. The detail is passed as is. Allowed only when the source detail is assignable to the target detail     |
| `{ type, detail }` | The target event name and a function `(detail, event) => ...` that creates the target detail from the source detail and event |

| Option    | Type          | Description                                                                                |
| --------- | ------------- | ------------------------------------------------------------------------------------------ |
| `owner?`  | `any`         | Owner of the source's handlers. Relaying can be stopped with the source's `off({ owner })` |
| `signal?` | `AbortSignal` | Stops relaying when aborted                                                                |

If the source's `on` throws (such as an error from an activation function), relaying already registered is stopped before the error is thrown. If errors are thrown while stopping, all relaying is stopped before they are thrown.

### Types

| Type                          | Description                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `EventMap`                    | Base type of event maps                                                                                    |
| `EventInfo<M, K>`             | The event passed to handlers                                                                               |
| `EventHandler<M, K>`          | Event handler                                                                                              |
| `OnHandlerOptions`            | Options for `on`                                                                                           |
| `OffHandlerOptions`           | Options for `off`                                                                                          |
| `EventSubscribable<M>`        | Interface for subscribing only (`on` / `off`). Use it for the type exposed to the outside                  |
| `EventDispatcherLike<M>`      | Interface for subscribing, dispatching and suspending (no `dispose`). Use it for the type a child receives |
| `Evented<M>`                  | Interface of classes that have an `events` property for subscribing                                        |
| `SuspendMode`                 | What happens to suspended events (`'ignore' \| 'queue' \| 'latest'`)                                       |
| `EventDispatcherOptions<M>`   | Options for the `EventDispatcher` constructor                                                              |
| `EventActivator<M, K>`        | Activation function of an event. Can return a deactivation function                                        |
| `EventActivatorContext<M, K>` | Information passed to an activation function                                                               |
| `SyncFunction<R>`             | Synchronous function passed to `suspendDuring` (a function returning a Promise is a type error)            |
| `RelayMap<S, T>`              | The target for each source event name in `relay`                                                           |
| `RelayTarget<S, T, K>`        | A target in `relay` (an event name, or `{ type, detail }`)                                                 |
| `RelayOptions`                | Options for `relay`                                                                                        |

## License

MIT
