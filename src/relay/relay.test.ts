import EventDispatcher from '../EventDispatcher/EventDispatcher';
import type { EventSubscribable } from '../types';
import relay from './relay';

type FieldEvents = {
  change: { value: string };
  beforeChange: { value: string };
  focus: void;
};

type RecordEvents = {
  change: { values: Record<string, string> };
  fieldChange: { name: string; value: string };
  fieldValueChange: { value: string };
  beforeFieldChange: { value: string };
  fieldFocus: void;
};

describe('relay', () => {
  let field: EventDispatcher<FieldEvents>;
  let record: EventDispatcher<RecordEvents>;

  beforeEach(() => {
    field = new EventDispatcher<FieldEvents>();
    record = new EventDispatcher<RecordEvents>();
  });

  it('イベント名だけを指定するとdetailをそのまま転送する', () => {
    const handler = vi.fn();
    record.on('fieldValueChange', handler);
    relay(field, record, { change: 'fieldValueChange' });
    field.dispatch('change', { value: 'a' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fieldValueChange',
        detail: { value: 'a' },
      }),
    );
  });

  it('detailを指定すると転送元のdetailとイベントから転送先のdetailを作る', () => {
    const handler = vi.fn();
    record.on('fieldChange', handler);
    relay(field, record, {
      change: {
        type: 'fieldChange',
        detail: (detail, event) => ({ name: String(event.type), ...detail }),
      },
    });
    field.dispatch('change', { value: 'a' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { name: 'change', value: 'a' } }),
    );
  });

  it('detailのないイベントを転送できる', () => {
    const handler = vi.fn();
    record.on('fieldFocus', handler);
    relay(field, record, { focus: 'fieldFocus' });
    field.dispatch('focus');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('転送元の自身のハンドラーも呼ばれる', () => {
    const handler = vi.fn();
    field.on('change', handler);
    relay(field, record, { change: 'fieldValueChange' });
    field.dispatch('change', { value: 'a' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('mapに指定していないイベントは転送しない', () => {
    const handler = vi.fn();
    record.on('fieldFocus', handler);
    relay(field, record, { change: 'fieldValueChange' });
    field.dispatch('focus');
    expect(handler).not.toHaveBeenCalled();
  });

  it('戻り値の関数を呼ぶとすべての転送をやめる', () => {
    const handler = vi.fn();
    record.on(['fieldValueChange', 'fieldFocus'], handler);
    const off = relay(field, record, {
      change: 'fieldValueChange',
      focus: 'fieldFocus',
    });
    off();
    off();
    field.dispatch('change', { value: 'a' });
    field.dispatch('focus');
    expect(handler).not.toHaveBeenCalled();
    expect(field.hasHandlers('change')).toBe(false);
  });

  it('signalをabortすると転送をやめる', () => {
    const handler = vi.fn();
    record.on('fieldValueChange', handler);
    const controller = new AbortController();
    relay(
      field,
      record,
      { change: 'fieldValueChange' },
      { signal: controller.signal },
    );
    controller.abort();
    field.dispatch('change', { value: 'a' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ownerを指定すると転送元のoff({ owner })で転送をやめられる', () => {
    const owner = {};
    const handler = vi.fn();
    record.on('fieldValueChange', handler);
    relay(field, record, { change: 'fieldValueChange' }, { owner });
    field.off({ owner });
    field.dispatch('change', { value: 'a' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('転送先でpreventDefaultが呼ばれると、転送元のdispatchもfalseを返す', () => {
    record.on('beforeFieldChange', (event) => event.preventDefault());
    relay(field, record, { beforeChange: 'beforeFieldChange' });
    expect(field.dispatch('beforeChange', { value: 'a' })).toBe(false);
  });

  it('転送先が抑止中の場合は、転送先のモードに従い、キャンセルは戻らない', () => {
    const handler = vi.fn((event) => event.preventDefault());
    record.on('beforeFieldChange', handler);
    relay(field, record, { beforeChange: 'beforeFieldChange' });
    record.suspend('queue');
    expect(field.dispatch('beforeChange', { value: 'a' })).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    record.resume();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('転送先のハンドラーの例外は転送元のdispatchから投げられる', () => {
    const error = new Error('record');
    record.on('fieldValueChange', () => {
      throw error;
    });
    relay(field, record, { change: 'fieldValueChange' });
    expect(() => field.dispatch('change', { value: 'a' })).toThrow(error);
  });

  it('転送元のonで例外が発生した場合は、登録済みの転送をやめてから投げる', () => {
    const error = new Error('activate');
    const source = new EventDispatcher<FieldEvents>({
      activate: {
        focus: () => {
          throw error;
        },
      },
    });
    expect(() =>
      relay(source, record, {
        change: 'fieldValueChange',
        focus: 'fieldFocus',
      }),
    ).toThrow(error);
    expect(source.hasHandlers('change')).toBe(false);
    expect(source.hasHandlers('focus')).toBe(false);
  });

  it('登録の取り消しでも例外が発生した場合は、AggregateErrorにまとめて投げる', () => {
    const activateError = new Error('activate');
    const deactivateError = new Error('deactivate');
    const source = new EventDispatcher<FieldEvents>({
      activate: {
        change: () => () => {
          throw deactivateError;
        },
        focus: () => {
          throw activateError;
        },
      },
    });
    try {
      relay(source, record, {
        change: 'fieldValueChange',
        focus: 'fieldFocus',
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
      expect((e as AggregateError).errors).toEqual([
        activateError,
        deactivateError,
      ]);
    }
    expect(source.hasHandlers('change')).toBe(false);
  });

  it('値がundefinedのイベントは転送しない', () => {
    relay(field, record, { change: undefined, focus: 'fieldFocus' });
    expect(field.hasHandlers('change')).toBe(false);
    expect(field.hasHandlers('focus')).toBe(true);
  });

  it('転送をやめるときに例外が発生しても、すべてやめてから投げる', () => {
    const error = new Error('deactivate');
    const source = new EventDispatcher<FieldEvents>({
      activate: {
        change: () => () => {
          throw error;
        },
      },
    });
    const off = relay(source, record, {
      change: 'fieldValueChange',
      focus: 'fieldFocus',
    });
    expect(() => off()).toThrow(error);
    expect(source.hasHandlers('change')).toBe(false);
    expect(source.hasHandlers('focus')).toBe(false);
  });

  it('購読用のインターフェイスを転送元にできる', () => {
    const handler = vi.fn();
    record.on('fieldValueChange', handler);
    const events: EventSubscribable<FieldEvents> = field;
    relay(events, record, { change: 'fieldValueChange' });
    field.dispatch('change', { value: 'a' });
    expect(handler).toHaveBeenCalledOnce();
  });

  describe('型', () => {
    it('detailの型が合わないイベント名だけの指定は型エラーになる', () => {
      relay(field, record, {
        // @ts-expect-error fieldChange の detail には name が必要
        change: 'fieldChange',
      });
      relay(field, record, {
        // @ts-expect-error change の detail の型が異なる
        change: 'change',
      });
    });

    it('detailの戻り値は転送先のdetailの型でチェックされる', () => {
      relay(field, record, {
        change: {
          type: 'fieldChange',
          detail: (detail) => {
            expectTypeOf(detail).toEqualTypeOf<{ value: string }>();
            return { name: 'a', value: detail.value };
          },
        },
      });
      relay(field, record, {
        change: {
          type: 'fieldChange',
          // @ts-expect-error name がない
          detail: (detail) => ({ value: detail.value }),
        },
      });
    });

    it('存在しないイベント名は型エラーになる', () => {
      relay(field, record, {
        // @ts-expect-error 転送先に存在しないイベント名
        change: 'unknown',
      });
      relay(field, record, {
        // @ts-expect-error 転送元に存在しないイベント名
        unknown: 'fieldValueChange',
      });
    });
  });
});
