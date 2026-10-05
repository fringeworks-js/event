/**
 * 内部でハンドラーを持つ際の形式\
 * 複数のイベント名で登録した場合は、同じエントリーを各イベントで共有する
 */
export type HandlerEntry = {
  /**
   * ハンドラー
   */
  handler: (event: any) => void;

  /**
   * オーナー
   */
  owner: any;

  /**
   * 一度だけ呼ばれるかどうか
   */
  once: boolean;

  /**
   * once のハンドラーが呼ばれたかどうか
   */
  fired: boolean;

  /**
   * このエントリーが登録されているイベント名
   */
  types: Set<PropertyKey>;

  /**
   * すべてのイベントから削除されたときの後始末
   */
  cleanup: () => void;
};

/**
 * 抑止中に溜めておくイベント
 */
export type QueuedEvent = {
  type: PropertyKey;
  detail: unknown;
};
