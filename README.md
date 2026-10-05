# @fringeworks/event

`@fringeworks/event` is a library some will find handy, for simple event handling.\
On top of type-safe event registration and dispatching, it lets parents and children share an instance, suspends events and dispatches them later in bulk, and supports cancelable events.

**[日本語のREADMEはこちら](./README.ja.md)**

## Features

- Type-safe: each event name has its own detail type, and even when subscribing to multiple events at once, `type` narrows the detail.
- Shared instances: pass the parent's `EventDispatcher` to a child, and the parent's subscribers receive the child's events.
- Suspension: temporarily stop dispatching, then choose whether suspended events are ignored, all dispatched, or only the last one dispatched.
- Cancellation: calling `preventDefault()` in a handler makes `dispatch` return `false`.
- Works with standard APIs: unsubscribe with an `AbortSignal` and dispose with the `using` declaration.

## Installation

```sh
npm install @fringeworks/event
```

TypeScript 5.2 or later is required when using it with TypeScript.

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

```ts
import {
  EventDispatcher,
  type EventDispatcherLike,
  type Evented,
} from '@fringeworks/event';

type ToolbarEvents = {
  click: { button: string };
};

type GridEvents = ToolbarEvents & {
  select: { row: number };
};

class Toolbar implements Evented<ToolbarEvents> {
  constructor(readonly events: EventDispatcherLike<ToolbarEvents>) {}
}

class Grid implements Evented<GridEvents> {
  readonly events = new EventDispatcher<GridEvents>();
  readonly toolbar = new Toolbar(this.events);
}

const grid = new Grid();
grid.events.on('click', (event) => console.log(event.detail.button));
```

Only the side that created a shared instance (`Grid` in the example above) should call its `dispose`. If the receiving side (`Toolbar`) calls `dispose`, all subscriptions of the parent and other children are removed as well.\
To remove only the handlers it registered, the receiving side should pass `owner` when registering and use `off({ owner: this })`.

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

| Method                        | Description                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `on(type, handler, options?)` | Registers a handler and returns a function that removes it. `type` can be an array. Duplicate handlers are ignored |
| `off(type, options?)`         | Removes handlers. Without `options`, removes all handlers of the event                                             |
| `off(options)`                | Removes the given handler, or the handlers of the given owner, from all events                                     |
| `dispatch(type, detail?)`     | Dispatches an event. Returns `false` if `preventDefault()` was called (always `true` while suspended)              |
| `suspend(mode?)`              | Suspends dispatching                                                                                               |
| `resume()`                    | Resumes dispatching and dispatches the kept events                                                                 |
| `suspendDuring(fn, mode?)`    | Suspends only while the function runs and returns its result                                                       |
| `dispose()`                   | Removes all handlers and kept events, and resumes dispatching                                                      |

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

Resumes dispatching. Once fully resumed, the kept events are dispatched.

#### `suspendDuring`

```ts
suspendDuring<R>(fn: () => R, mode?: SuspendMode): R
```

Suspends dispatching only while `fn` runs, and returns its result. `fn` runs synchronously, and dispatching is resumed even if it throws. Passing a function that returns a Promise is a type error.

#### `dispose`

```ts
dispose(): void
```

Removes all handlers and kept events, and resumes dispatching. Also called when leaving the scope of a `using` declaration.

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

### Types

| Type                     | Description                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `EventMap`               | Base type of event maps                                              |
| `EventInfo<M, K>`        | The event passed to handlers                                         |
| `EventHandler<M, K>`     | Event handler                                                        |
| `OnHandlerOptions`       | Options for `on`                                                     |
| `OffHandlerOptions`      | Options for `off`                                                    |
| `EventDispatcherLike<M>` | Interface of `EventDispatcher`. Use it for the type a child receives |
| `Evented<M>`             | Interface of classes that have an `events` property                  |
| `SuspendMode`            | What happens to suspended events (`'ignore' \| 'queue' \| 'latest'`) |

## License

MIT
