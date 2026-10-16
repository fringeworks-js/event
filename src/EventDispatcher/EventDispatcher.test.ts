import type {
  EventDispatcherLike,
  EventInfo,
  EventSubscribable,
  Evented,
} from '../types';
import EventDispatcher from './EventDispatcher';

// テスト用イベントマップ
type TestEvents = {
  click: { x: number; y: number };
  change: { value: string };
  focus: { target: string };
  reset: void;
};

describe('EventDispatcher', () => {
  let dispatcher: EventDispatcher<TestEvents>;

  beforeEach(() => {
    dispatcher = new EventDispatcher<TestEvents>();
  });

  // -------------------------
  // on
  // -------------------------
  describe('on', () => {
    it('登録したハンドラーがdispatch時に呼ばれる', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('dispatchのdetailがEventInfoとしてハンドラーに渡される', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          detail: { x: 10, y: 20 },
          defaultPrevented: false,
        }),
      );
    });

    it('複数のハンドラーを登録すると登録順にすべて呼ばれる', () => {
      const calls: number[] = [];
      dispatcher.on('click', () => calls.push(1));
      dispatcher.on('click', () => calls.push(2));
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(calls).toEqual([1, 2]);
    });

    it('異なるイベントのハンドラーは互いに干渉しない', () => {
      const clickHandler = vi.fn();
      const changeHandler = vi.fn();
      dispatcher.on('click', clickHandler);
      dispatcher.on('change', changeHandler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(clickHandler).toHaveBeenCalledOnce();
      expect(changeHandler).not.toHaveBeenCalled();
    });

    it('同一ハンドラーを重複登録しても1回しか呼ばれない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('イベント名の大文字小文字は区別される', () => {
      const events = new EventDispatcher<{ a: void; A: void }>();
      const handler = vi.fn();
      events.on('a', handler);
      events.dispatch('A');
      expect(handler).not.toHaveBeenCalled();
    });

    it('戻り値の関数を呼ぶとハンドラーが削除される', () => {
      const handler = vi.fn();
      const off = dispatcher.on('click', handler);
      off();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('戻り値の関数を複数回呼んでもエラーにならない', () => {
      const off = dispatcher.on('click', vi.fn());
      off();
      expect(() => off()).not.toThrow();
    });

    it('重複で無視された登録の戻り値では既存のハンドラーは削除されない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      const off = dispatcher.on('click', handler);
      off();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    describe('複数のイベント名', () => {
      it('配列で指定したすべてのイベントで呼ばれる', () => {
        const handler = vi.fn();
        dispatcher.on(['click', 'change'], handler);
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'test' });
        dispatcher.dispatch('focus', { target: 'input' });
        expect(handler).toHaveBeenCalledTimes(2);
      });

      it('戻り値の関数ですべてのイベントから削除される', () => {
        const handler = vi.fn();
        const off = dispatcher.on(['click', 'change'], handler);
        off();
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'test' });
        expect(handler).not.toHaveBeenCalled();
      });

      it('typeでdetailの型を絞り込める', () => {
        const values: (number | string)[] = [];
        dispatcher.on(['click', 'change'], (event) => {
          if (event.type === 'click') {
            values.push(event.detail.x);
          } else {
            values.push(event.detail.value);
          }
        });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'test' });
        expect(values).toEqual([10, 'test']);
      });
    });

    describe('once', () => {
      it('一度呼ばれたら削除される', () => {
        const handler = vi.fn();
        dispatcher.on('click', handler, { once: true });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        expect(handler).toHaveBeenCalledOnce();
      });

      it('複数のイベント名の場合はいずれかで一度呼ばれたら削除される', () => {
        const handler = vi.fn();
        dispatcher.on(['click', 'change'], handler, { once: true });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'test' });
        expect(handler).toHaveBeenCalledOnce();
      });

      it('ハンドラー内で同じイベントを再帰的にdispatchしても一度しか呼ばれない', () => {
        const handler = vi.fn(() => {
          dispatcher.dispatch('click', { x: 0, y: 0 });
        });
        dispatcher.on('click', handler, { once: true });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        expect(handler).toHaveBeenCalledOnce();
      });

      it('登録済みのイベントは重複として無視され、残りのイベントだけがonceになる', () => {
        const handler = vi.fn();
        dispatcher.on('click', handler);
        dispatcher.on(['click', 'change'], handler, { once: true });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'a' });
        dispatcher.dispatch('change', { value: 'b' });
        // click は既存の登録のまま毎回呼ばれ、change は once で1回だけ呼ばれる
        expect(handler).toHaveBeenCalledTimes(3);
      });
    });

    describe('signal', () => {
      it('abortするとハンドラーが削除される', () => {
        const controller = new AbortController();
        const handler = vi.fn();
        dispatcher.on(['click', 'change'], handler, {
          signal: controller.signal,
        });
        controller.abort();
        dispatcher.dispatch('click', { x: 10, y: 20 });
        dispatcher.dispatch('change', { value: 'test' });
        expect(handler).not.toHaveBeenCalled();
      });

      it('abort済みのsignalを指定すると登録されない', () => {
        const controller = new AbortController();
        controller.abort();
        const handler = vi.fn();
        dispatcher.on('click', handler, { signal: controller.signal });
        dispatcher.dispatch('click', { x: 10, y: 20 });
        expect(handler).not.toHaveBeenCalled();
      });

      it('ハンドラーが削除されるとsignalのリスナーも解除される', () => {
        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const off = dispatcher.on('click', vi.fn(), {
          signal: controller.signal,
        });
        off();
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
      });
    });
  });

  // -------------------------
  // off
  // -------------------------
  describe('off', () => {
    it('ハンドラーを指定して削除できる', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.off('click', { handler });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('ownerを指定して削除できる', () => {
      const owner = {};
      const handler = vi.fn();
      dispatcher.on('click', handler, { owner });
      dispatcher.off('click', { owner });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('ownerを指定して全イベントのハンドラーをまとめて削除できる', () => {
      const owner = {};
      const clickHandler = vi.fn();
      const changeHandler = vi.fn();
      dispatcher.on('click', clickHandler, { owner });
      dispatcher.on('change', changeHandler, { owner });
      dispatcher.off({ owner });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      expect(clickHandler).not.toHaveBeenCalled();
      expect(changeHandler).not.toHaveBeenCalled();
    });

    it('指定したowner以外のハンドラーは削除されない', () => {
      const owner1 = {};
      const owner2 = {};
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      dispatcher.on('click', handler1, { owner: owner1 });
      dispatcher.on('click', handler2, { owner: owner2 });
      dispatcher.off('click', { owner: owner1 });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('オプションを省略するとそのイベントのハンドラーがすべて削除される', () => {
      const owner = {};
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const changeHandler = vi.fn();
      dispatcher.on('click', handler1);
      dispatcher.on('click', handler2, { owner });
      dispatcher.on('change', changeHandler);
      dispatcher.off('click');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(changeHandler).toHaveBeenCalledOnce();
    });

    it('複数のイベント名を指定して削除できる', () => {
      const handler = vi.fn();
      dispatcher.on(['click', 'change', 'focus'], handler);
      dispatcher.off(['click', 'change'], { handler });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      dispatcher.dispatch('focus', { target: 'input' });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('存在しないハンドラーを削除してもエラーにならない', () => {
      const handler = vi.fn();
      expect(() => dispatcher.off('click', { handler })).not.toThrow();
    });

    it('ownerがundefinedの場合は何も削除しない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      const owner: object | undefined = undefined;
      dispatcher.off({ owner });
      dispatcher.off('click', { owner });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('handlerがundefinedの場合は何も削除しない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.off({ handler: undefined as any });
      dispatcher.off('click', { handler: undefined as any });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  // -------------------------
  // hasHandlers
  // -------------------------
  describe('hasHandlers', () => {
    it('ハンドラーが登録されているかどうかを返す', () => {
      expect(dispatcher.hasHandlers('click')).toBe(false);
      const off = dispatcher.on('click', vi.fn());
      expect(dispatcher.hasHandlers('click')).toBe(true);
      expect(dispatcher.hasHandlers('change')).toBe(false);
      off();
      expect(dispatcher.hasHandlers('click')).toBe(false);
    });
  });

  // -------------------------
  // dispatch
  // -------------------------
  describe('dispatch', () => {
    it('ハンドラーが登録されていないイベントをdispatchしてもエラーにならない', () => {
      expect(() =>
        dispatcher.dispatch('click', { x: 10, y: 20 }),
      ).not.toThrow();
    });

    it('detailがvoidのイベントはdetailを省略できる', () => {
      const handler = vi.fn();
      dispatcher.on('reset', handler);
      dispatcher.dispatch('reset');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'reset', detail: undefined }),
      );
    });

    it('preventDefaultが呼ばれなければtrueを返す', () => {
      dispatcher.on('click', vi.fn());
      expect(dispatcher.dispatch('click', { x: 10, y: 20 })).toBe(true);
    });

    it('preventDefaultが呼ばれるとfalseを返す', () => {
      dispatcher.on('click', (event) => event.preventDefault());
      expect(dispatcher.dispatch('click', { x: 10, y: 20 })).toBe(false);
    });

    it('preventDefaultが呼ばれても後続のハンドラーは呼ばれ、defaultPreventedで確認できる', () => {
      const handler = vi.fn((event: EventInfo<TestEvents, 'click'>) => {
        expect(event.defaultPrevented).toBe(true);
      });
      dispatcher.on('click', (event) => event.preventDefault());
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('stopImmediatePropagationが呼ばれると残りのハンドラーは呼ばれない', () => {
      const handler = vi.fn();
      dispatcher.on('click', (event) => event.stopImmediatePropagation());
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('stopImmediatePropagationは次回のdispatchには影響しない', () => {
      const handler = vi.fn();
      let stop = true;
      dispatcher.on('click', (event) => {
        if (stop) {
          event.stopImmediatePropagation();
        }
      });
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      stop = false;
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('stopImmediatePropagationで呼ばれなかったonceのハンドラーは削除されない', () => {
      const handler = vi.fn();
      const stopper = (event: EventInfo<TestEvents, 'click'>) =>
        event.stopImmediatePropagation();
      dispatcher.on('click', stopper);
      dispatcher.on('click', handler, { once: true });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.off('click', { handler: stopper });
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('stopImmediatePropagationとpreventDefaultを併用できる', () => {
      dispatcher.on('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      });
      dispatcher.on('click', vi.fn());
      expect(dispatcher.dispatch('click', { x: 10, y: 20 })).toBe(false);
    });

    it('dispatchの実行中にonが呼ばれても同回のdispatchには影響しない', () => {
      const handler2 = vi.fn();
      const handler1 = vi.fn(() => {
        dispatcher.on('click', handler2);
      });
      dispatcher.on('click', handler1);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('dispatchの実行中にoffされたハンドラーは同回のdispatchでも呼ばれない', () => {
      const handler2 = vi.fn();
      const handler1 = vi.fn(() => {
        dispatcher.off('click', { handler: handler2 });
      });
      dispatcher.on('click', handler1);
      dispatcher.on('click', handler2);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler2).not.toHaveBeenCalled();
    });

    it('dispatchの実行中に別のイベントからだけoffされたハンドラーは呼ばれる', () => {
      const handler2 = vi.fn();
      const handler1 = vi.fn(() => {
        dispatcher.off('change', { handler: handler2 });
      });
      dispatcher.on('click', handler1);
      dispatcher.on(['click', 'change'], handler2);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('dispatchの実行中にdisposeされると残りのハンドラーは呼ばれない', () => {
      const handler2 = vi.fn();
      dispatcher.on('click', () => dispatcher.dispose());
      dispatcher.on('click', handler2);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler2).not.toHaveBeenCalled();
    });

    it('dispatchの実行中にoffして同じハンドラーを登録し直しても同回のdispatchでは呼ばれない', () => {
      const handler2 = vi.fn();
      const handler1 = vi.fn(() => {
        dispatcher.off('click', { handler: handler2 });
        dispatcher.on('click', handler2);
      });
      dispatcher.on('click', handler1, { once: true });
      dispatcher.on('click', handler2);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler2).not.toHaveBeenCalled();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler2).toHaveBeenCalledOnce();
    });

    describe('例外', () => {
      it('ハンドラーで例外が発生しても残りのハンドラーは呼ばれ、最後に例外が投げられる', () => {
        const error = new Error('test');
        const handler = vi.fn();
        dispatcher.on('click', () => {
          throw error;
        });
        dispatcher.on('click', handler);
        expect(() => dispatcher.dispatch('click', { x: 10, y: 20 })).toThrow(
          error,
        );
        expect(handler).toHaveBeenCalledOnce();
      });

      it('複数のハンドラーで例外が発生するとAggregateErrorにまとめて投げられる', () => {
        const error1 = new Error('1');
        const error2 = new Error('2');
        dispatcher.on('click', () => {
          throw error1;
        });
        dispatcher.on('click', () => {
          throw error2;
        });
        try {
          dispatcher.dispatch('click', { x: 10, y: 20 });
          expect.unreachable();
        } catch (e) {
          expect(e).toBeInstanceOf(AggregateError);
          expect((e as AggregateError).errors).toEqual([error1, error2]);
        }
      });
    });
  });

  // -------------------------
  // suspend / resume
  // -------------------------
  describe('suspend / resume', () => {
    it('suspendするとdispatchしてもハンドラーが呼ばれない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.suspend();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('抑止中のdispatchはtrueを返す', () => {
      dispatcher.on('click', (event) => event.preventDefault());
      dispatcher.suspend();
      expect(dispatcher.dispatch('click', { x: 10, y: 20 })).toBe(true);
    });

    it('デフォルト（ignore）では抑止中のイベントは無視される', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.suspend();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.resume();
      expect(handler).not.toHaveBeenCalled();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('queueでは抑止中のイベントがすべて発火順に発火される', () => {
      const types: string[] = [];
      dispatcher.on(['click', 'change'], (event) => types.push(event.type));
      dispatcher.suspend('queue');
      dispatcher.dispatch('click', { x: 1, y: 1 });
      dispatcher.dispatch('change', { value: 'a' });
      dispatcher.dispatch('click', { x: 2, y: 2 });
      expect(types).toEqual([]);
      dispatcher.resume();
      expect(types).toEqual(['click', 'change', 'click']);
    });

    it('latestではイベント名ごとに最後の1件だけが発火される', () => {
      const received: unknown[] = [];
      dispatcher.on(['click', 'change'], (event) =>
        received.push(event.detail),
      );
      dispatcher.suspend('latest');
      dispatcher.dispatch('click', { x: 1, y: 1 });
      dispatcher.dispatch('change', { value: 'a' });
      dispatcher.dispatch('click', { x: 2, y: 2 });
      dispatcher.resume();
      expect(received).toEqual([{ value: 'a' }, { x: 2, y: 2 }]);
    });

    it('suspendを複数回呼んだ場合、同じ回数resumeしないと有効に戻らない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.suspend();
      dispatcher.suspend();
      dispatcher.resume();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
      dispatcher.resume();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('入れ子の場合は一番外側のmodeに従う', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.suspend('queue');
      dispatcher.suspend('ignore');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.resume();
      expect(handler).not.toHaveBeenCalled();
      dispatcher.resume();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('resumeを余分に呼んでも抑止カウントが0未満にならない', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.resume();
      dispatcher.resume();
      dispatcher.suspend();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('溜めていたイベントのハンドラーで例外が発生しても残りのイベントは発火される', () => {
      const error = new Error('test');
      const changeHandler = vi.fn();
      dispatcher.on('click', () => {
        throw error;
      });
      dispatcher.on('change', changeHandler);
      dispatcher.suspend('queue');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      expect(() => dispatcher.resume()).toThrow(error);
      expect(changeHandler).toHaveBeenCalledOnce();
    });

    it('溜めていたイベントの発火中にdispatchしたイベントは、残りの溜めていたイベントより先に発火される', () => {
      const log: string[] = [];
      dispatcher.on('click', () => {
        log.push('click');
        dispatcher.dispatch('focus', { target: 'nested' });
      });
      dispatcher.on(['change', 'focus'], (event) => log.push(event.type));
      dispatcher.suspend('queue');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      dispatcher.resume();
      expect(log).toEqual(['click', 'focus', 'change']);
    });

    it('溜めていたイベントの発火中にsuspendしても、残りの溜めていたイベントは発火される', () => {
      const changeHandler = vi.fn();
      const focusHandler = vi.fn();
      dispatcher.on('click', () => {
        dispatcher.suspend();
        dispatcher.dispatch('focus', { target: 'ignored' });
      });
      dispatcher.on('change', changeHandler);
      dispatcher.on('focus', focusHandler);
      dispatcher.suspend('queue');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      dispatcher.resume();
      expect(changeHandler).toHaveBeenCalledOnce();
      // ハンドラーでの suspend は有効で、その後の dispatch は抑止される
      expect(focusHandler).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // suspendDuring
  // -------------------------
  describe('suspendDuring', () => {
    it('関数の実行中だけ抑止され、関数の戻り値が返る', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      const result = dispatcher.suspendDuring(() => {
        dispatcher.dispatch('click', { x: 10, y: 20 });
        return 'done';
      });
      expect(result).toBe('done');
      expect(handler).not.toHaveBeenCalled();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('modeを指定できる', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.suspendDuring(() => {
        dispatcher.dispatch('click', { x: 1, y: 1 });
        dispatcher.dispatch('click', { x: 2, y: 2 });
      }, 'latest');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { x: 2, y: 2 } }),
      );
    });

    it('関数で例外が発生しても抑止は解除される', () => {
      const handler = vi.fn();
      dispatcher.on('click', handler);
      expect(() =>
        dispatcher.suspendDuring(() => {
          throw new Error('test');
        }),
      ).toThrow('test');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('関数の例外は抑止の解除時のハンドラーの例外で失われず、AggregateErrorにまとめられる', () => {
      const fnError = new Error('fn');
      const handlerError = new Error('handler');
      dispatcher.on('click', () => {
        throw handlerError;
      });
      try {
        dispatcher.suspendDuring(() => {
          dispatcher.dispatch('click', { x: 10, y: 20 });
          throw fnError;
        }, 'queue');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AggregateError);
        expect((e as AggregateError).errors).toEqual([fnError, handlerError]);
      }
    });

    it('関数で例外が発生し、ハンドラーで例外が発生しなければ関数の例外がそのまま投げられる', () => {
      const fnError = new Error('fn');
      const handler = vi.fn();
      dispatcher.on('click', handler);
      expect(() =>
        dispatcher.suspendDuring(() => {
          dispatcher.dispatch('click', { x: 10, y: 20 });
          throw fnError;
        }, 'queue'),
      ).toThrow(fnError);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('戻り値の型が推論される', () => {
      expectTypeOf(dispatcher.suspendDuring(() => 1)).toEqualTypeOf<number>();
      expectTypeOf(
        dispatcher.suspendDuring(() => ({ value: 'a' })),
      ).toEqualTypeOf<{ value: string }>();
      expectTypeOf(dispatcher.suspendDuring(() => {})).toEqualTypeOf<void>();
    });

    it('Promiseを返す関数は型エラーになる', async () => {
      // @ts-expect-error async 関数は渡せない
      await dispatcher.suspendDuring(async () => {});
      // @ts-expect-error Promise を返す関数は渡せない
      await dispatcher.suspendDuring(() => Promise.resolve(1));
    });
  });

  // -------------------------
  // dispose
  // -------------------------
  describe('dispose', () => {
    it('disposeを呼ぶと全ハンドラーが削除される', () => {
      const clickHandler = vi.fn();
      const changeHandler = vi.fn();
      dispatcher.on('click', clickHandler);
      dispatcher.on('change', changeHandler);
      dispatcher.dispose();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispatch('change', { value: 'test' });
      expect(clickHandler).not.toHaveBeenCalled();
      expect(changeHandler).not.toHaveBeenCalled();
    });

    it('disposeを呼ぶと溜めていたイベントが削除され、抑止が解除される', () => {
      dispatcher.suspend('queue');
      dispatcher.dispatch('click', { x: 10, y: 20 });
      dispatcher.dispose();
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.resume();
      expect(handler).not.toHaveBeenCalled();
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('dispose後も再び登録・発火できる', () => {
      dispatcher.on('click', vi.fn());
      dispatcher.dispose();
      const handler = vi.fn();
      dispatcher.on('click', handler);
      dispatcher.dispatch('click', { x: 10, y: 20 });
      expect(handler).toHaveBeenCalledOnce();
    });

    it('signal付きのハンドラーはdisposeでsignalのリスナーも解除される', () => {
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
      dispatcher.on(['click', 'change'], vi.fn(), {
        signal: controller.signal,
      });
      dispatcher.dispose();
      expect(removeSpy).toHaveBeenCalledOnce();
    });

    it('using構文でスコープを抜けるとdisposeされる', () => {
      const handler = vi.fn();
      let events: EventDispatcher<TestEvents>;
      {
        using scoped = new EventDispatcher<TestEvents>();
        events = scoped;
        events.on('click', handler);
      }
      events.dispatch('click', { x: 10, y: 20 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // activate
  // -------------------------
  describe('activate', () => {
    // click の有効化と無効化の呼び出しを記録する dispatcher を作る
    const create = () => {
      const log: string[] = [];
      const events = new EventDispatcher<TestEvents>({
        activate: {
          click: ({ type }) => {
            log.push(`activate:${type}`);
            return () => log.push(`deactivate:${type}`);
          },
          change: ({ type }) => {
            log.push(`activate:${type}`);
            return () => log.push(`deactivate:${type}`);
          },
        },
      });
      return { events, log };
    };

    it('最初のハンドラーが登録されたときだけ有効化される', () => {
      const { events, log } = create();
      events.on('click', vi.fn());
      events.on('click', vi.fn());
      expect(log).toEqual(['activate:click']);
    });

    it('最後のハンドラーが削除されたときに無効化される', () => {
      const { events, log } = create();
      const off1 = events.on('click', vi.fn());
      const off2 = events.on('click', vi.fn());
      off1();
      expect(log).toEqual(['activate:click']);
      off2();
      expect(log).toEqual(['activate:click', 'deactivate:click']);
    });

    it('有効化の処理がないイベントでは何も起きない', () => {
      const { events, log } = create();
      events.on('focus', vi.fn())();
      expect(log).toEqual([]);
    });

    it('複数のイベント名で登録するとイベント名ごとに有効化・無効化される', () => {
      const { events, log } = create();
      events.on(['click', 'change'], vi.fn())();
      expect(log).toEqual([
        'activate:click',
        'activate:change',
        'deactivate:click',
        'deactivate:change',
      ]);
    });

    it.each([
      [
        'off(type)',
        (events: EventDispatcher<TestEvents>) => events.off('click'),
      ],
      [
        'off({ handler })',
        (events: EventDispatcher<TestEvents>, handler: () => void) =>
          events.off({ handler }),
      ],
      [
        'off({ owner })',
        (events: EventDispatcher<TestEvents>, _: () => void, owner: object) =>
          events.off({ owner }),
      ],
      ['dispose', (events: EventDispatcher<TestEvents>) => events.dispose()],
    ])('%sで削除しても無効化される', (_, remove) => {
      const { events, log } = create();
      const handler = vi.fn();
      const owner = {};
      events.on('click', handler, { owner });
      remove(events, handler, owner);
      expect(log).toEqual(['activate:click', 'deactivate:click']);
    });

    it('signalのabortで削除しても無効化される', () => {
      const { events, log } = create();
      const controller = new AbortController();
      events.on('click', vi.fn(), { signal: controller.signal });
      controller.abort();
      expect(log).toEqual(['activate:click', 'deactivate:click']);
    });

    it('onceのハンドラーが呼ばれると無効化される', () => {
      const { events, log } = create();
      events.on('click', () => log.push('handler'), { once: true });
      events.dispatch('click', { x: 10, y: 20 });
      expect(log).toEqual(['activate:click', 'deactivate:click', 'handler']);
    });

    it('無効化のあとに登録し直すと再び有効化される', () => {
      const { events, log } = create();
      events.on('click', vi.fn())();
      events.on('click', vi.fn());
      expect(log).toEqual([
        'activate:click',
        'deactivate:click',
        'activate:click',
      ]);
    });

    it('dispose後に登録すると再び有効化される', () => {
      const { events, log } = create();
      events.on('click', vi.fn());
      events.dispose();
      events.on('click', vi.fn());
      expect(log).toEqual([
        'activate:click',
        'deactivate:click',
        'activate:click',
      ]);
    });

    it('有効化の処理が関数を返さなくてもよい', () => {
      const activate = vi.fn();
      const events = new EventDispatcher<TestEvents>({
        activate: { click: activate },
      });
      events.on('click', vi.fn())();
      expect(activate).toHaveBeenCalledOnce();
    });

    it('有効化の処理の中で発火したイベントを登録したハンドラーが受け取れる', () => {
      const events = new EventDispatcher<TestEvents>({
        activate: {
          change: ({ dispatch }) => {
            dispatch('change', { value: 'initial' });
          },
        },
      });
      const handler = vi.fn();
      events.on('change', handler);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { value: 'initial' } }),
      );
    });

    it('有効化の処理の中でonceのハンドラーが削除された場合は、すぐに無効化される', () => {
      const deactivate = vi.fn();
      const events = new EventDispatcher<TestEvents>({
        activate: {
          change: ({ dispatch }) => {
            dispatch('change', { value: 'initial' });
            return deactivate;
          },
        },
      });
      events.on('change', vi.fn(), { once: true });
      expect(events.hasHandlers('change')).toBe(false);
      expect(deactivate).toHaveBeenCalledOnce();
    });

    it('有効化の処理の中で再び有効化された場合は、外側の有効化がすぐに無効化される', () => {
      const deactivates: string[] = [];
      let count = 0;
      const events = new EventDispatcher<TestEvents>({
        activate: {
          change: ({ dispatch }) => {
            const id = `#${++count}`;
            if (count === 1) {
              dispatch('change', { value: 'initial' });
            }
            return () => deactivates.push(id);
          },
        },
      });
      // once のハンドラーが初期値を受け取って削除され、ハンドラーの中で登録し直す
      events.on('change', () => events.on('change', vi.fn()), { once: true });
      expect(events.hasHandlers('change')).toBe(true);
      expect(deactivates).toEqual(['#1']);
      events.off('change');
      expect(deactivates).toEqual(['#1', '#2']);
    });

    describe('例外', () => {
      it('有効化の処理で例外が発生するとonから投げられ、登録は取り消される', () => {
        const error = new Error('activate');
        const log: string[] = [];
        const events = new EventDispatcher<TestEvents>({
          activate: {
            click: () => {
              log.push('activate:click');
              return () => log.push('deactivate:click');
            },
            change: () => {
              throw error;
            },
          },
        });
        const handler = vi.fn();
        expect(() => events.on(['click', 'change'], handler)).toThrow(error);
        expect(events.hasHandlers('click')).toBe(false);
        expect(events.hasHandlers('change')).toBe(false);
        // 先に有効化された click は無効化される
        expect(log).toEqual(['activate:click', 'deactivate:click']);
      });

      it('無効化の処理で例外が発生するとoffから投げられ、ハンドラーは削除される', () => {
        const error = new Error('deactivate');
        const events = new EventDispatcher<TestEvents>({
          activate: {
            click: () => () => {
              throw error;
            },
          },
        });
        const off = events.on('click', vi.fn());
        expect(() => off()).toThrow(error);
        expect(events.hasHandlers('click')).toBe(false);
      });

      it('disposeで無効化の処理の例外が発生しても、すべて削除してから投げられる', () => {
        const error = new Error('deactivate');
        const deactivate = vi.fn();
        const events = new EventDispatcher<TestEvents>({
          activate: {
            click: () => () => {
              throw error;
            },
            change: () => deactivate,
          },
        });
        events.on(['click', 'change'], vi.fn());
        events.suspend();
        expect(() => events.dispose()).toThrow(error);
        expect(events.hasHandlers('click')).toBe(false);
        expect(events.hasHandlers('change')).toBe(false);
        expect(deactivate).toHaveBeenCalledOnce();
        // 抑止も解除されている
        const handler = vi.fn();
        events.on('focus', handler);
        events.dispatch('focus', { target: 'input' });
        expect(handler).toHaveBeenCalledOnce();
      });

      it('dispatch中の無効化の処理の例外は、ハンドラーの例外と同じく最後に投げられる', () => {
        const error = new Error('deactivate');
        const events = new EventDispatcher<TestEvents>({
          activate: {
            click: () => () => {
              throw error;
            },
          },
        });
        const handler = vi.fn();
        events.on('click', handler, { once: true });
        expect(() => events.dispatch('click', { x: 10, y: 20 })).toThrow(error);
        expect(handler).toHaveBeenCalledOnce();
      });
    });

    it('有効化の処理の型', () => {
      new EventDispatcher<TestEvents>({
        activate: {
          click: ({ type, dispatch }) => {
            expectTypeOf(type).toEqualTypeOf<'click'>();
            dispatch('reset');
            // @ts-expect-error detail の型が違う
            dispatch('change', { x: 1 });
          },
          // @ts-expect-error 存在しないイベント名
          unknown: () => {},
        },
      });
    });
  });

  // -------------------------
  // 型
  // -------------------------
  describe('型', () => {
    it('イベント名やdetailの誤りは型エラーになる', () => {
      // @ts-expect-error 存在しないイベント名
      dispatcher.on('unknown', vi.fn());
      // @ts-expect-error detail の型が違う
      dispatcher.dispatch('click', { value: 'test' });
      // @ts-expect-error detail が必要なイベントでは省略できない
      dispatcher.dispatch('click');
    });

    it('ハンドラーのeventはイベント名に応じた型になる', () => {
      dispatcher.on('click', (event) => {
        expectTypeOf(event.type).toEqualTypeOf<'click'>();
        expectTypeOf(event.detail).toEqualTypeOf<{ x: number; y: number }>();
      });
      dispatcher.on(['click', 'change'], (event) => {
        expectTypeOf(event.type).toEqualTypeOf<'click' | 'change'>();
      });
    });

    it('interfaceで定義したイベントマップを使える', () => {
      interface InterfaceEvents {
        click: { x: number };
      }
      const events = new EventDispatcher<InterfaceEvents>();
      expectTypeOf(events).toExtend<EventDispatcherLike<InterfaceEvents>>();
    });
  });

  // -------------------------
  // 親子の注入パターン
  // -------------------------
  describe('親子の注入パターン', () => {
    type ChildEvents = {
      click: { x: number; y: number };
    };

    type ParentEvents = ChildEvents & {
      change: { value: string };
    };

    class Child implements Evented<ChildEvents> {
      readonly events: EventSubscribable<ChildEvents>;
      private readonly dispatcher: EventDispatcherLike<ChildEvents>;
      constructor(dispatcher: EventDispatcherLike<ChildEvents>) {
        this.dispatcher = dispatcher;
        this.events = dispatcher;
      }
      doClick() {
        this.dispatcher.dispatch('click', { x: 10, y: 20 });
      }
    }

    class Parent implements Evented<ParentEvents> {
      private readonly dispatcher = new EventDispatcher<ParentEvents>();
      readonly events: EventSubscribable<ParentEvents> = this.dispatcher;
      readonly child = new Child(this.dispatcher);
    }

    it('Eventedのeventsからはdispatchできない', () => {
      const parent = new Parent();
      // @ts-expect-error 購読用のインターフェイスには dispatch がない
      parent.events.dispatch('click', { x: 10, y: 20 });
    });

    it('子に渡すインターフェイスからはdisposeできない', () => {
      expectTypeOf<EventDispatcherLike<ChildEvents>>().not.toHaveProperty(
        'dispose',
      );
    });

    it('子の購読用インターフェイスに親のdispatcherを代入できる', () => {
      expectTypeOf<EventSubscribable<ParentEvents>>().toExtend<
        EventSubscribable<ChildEvents>
      >();
    });

    it('親のdispatcherを子に渡すと親経由でハンドラーが受け取れる', () => {
      const parent = new Parent();
      const handler = vi.fn();
      parent.events.on('click', handler);
      parent.child.doClick();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'click', detail: { x: 10, y: 20 } }),
      );
    });

    it('子より多くのイベントを持つ親のdispatcherを子に渡せる', () => {
      expectTypeOf<EventDispatcher<ParentEvents>>().toExtend<
        EventDispatcherLike<ChildEvents>
      >();
    });

    it('detailの型が異なるdispatcherは子に渡せない', () => {
      const events = new EventDispatcher<{ click: { x: string } }>();
      // @ts-expect-error click の detail の型が異なる
      new Child(events);
    });

    it('子が必要とするイベントを持たないdispatcherは子に渡せない', () => {
      const events = new EventDispatcher<{ change: { value: string } }>();
      // @ts-expect-error click イベントがない
      new Child(events);
    });
  });
});
