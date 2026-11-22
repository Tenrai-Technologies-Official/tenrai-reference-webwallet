/** Owns wallets produced by one gate action until a synchronous handoff. */
export interface GateWallet { close(): Promise<void>; }

export class GateAttempt {
  readonly #controller = new AbortController();
  readonly #ready: Promise<void>;
  readonly #current: () => boolean;
  readonly #finish: () => void;
  readonly #retain: (work: Promise<void>) => void;
  #wallet: GateWallet | undefined;
  #creating: Promise<void> | undefined;
  #lateClosing: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  #closed = false;

  constructor(ready: Promise<void>, current: () => boolean, finish: () => void, retain: (work: Promise<void>) => void) {
    this.#ready = ready; this.#current = current; this.#finish = finish; this.#retain = retain;
  }
  get current(): boolean { return this.#current(); }
  get signal(): AbortSignal { return this.#controller.signal; }
  assertOpen(): void {
    if (!this.current || this.#closed) throw new Error("This wallet-opening action is no longer active.");
  }
  async ready(): Promise<void> { await this.#ready; this.assertOpen(); }

  async wallet<T extends GateWallet>(factory: () => Promise<T>): Promise<T> {
    this.assertOpen();
    if (this.#creating) throw new Error("This wallet-opening action already owns a factory.");
    const creating = Promise.resolve().then(() => { this.assertOpen(); return factory(); }).then(async (wallet) => {
      if (!this.current || this.#closed) {
        this.#lateClosing = Promise.resolve().then(() => wallet.close());
        await this.#lateClosing;
        this.assertOpen();
      }
      this.#wallet = wallet;
      return wallet;
    });
    this.#creating = creating.then(() => {}, () => {});
    return creating;
  }

  handoff(wallet: GateWallet, deliver: () => void): void {
    this.assertOpen();
    if (this.#wallet !== wallet) throw new Error("This action does not own the opened wallet.");
    this.#wallet = undefined;
    this.#closed = true;
    this.#finish();
    try { deliver(); }
    catch (cause) {
      this.#closing = Promise.resolve().then(() => wallet.close());
      this.#retain(this.#closing);
      void this.#closing.catch(() => {});
      throw cause;
    }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#controller.abort(new Error("The wallet-opening action stopped."));
    const wallet = this.#wallet;
    this.#wallet = undefined;
    this.#closing = Promise.all([Promise.resolve(this.#creating).then(() => this.#lateClosing),
      Promise.resolve().then(() => wallet?.close())]).then(() => {});
    void this.#closing.catch(() => {});
    return this.#closing;
  }
}

/** Mode changes cancel synchronously; later actions wait for older factories and leases to drain. */
export class GateLifetime {
  #current: GateAttempt | undefined;
  #active = true;
  #draining: Promise<void> = Promise.resolve();
  resume(): void { this.#active = true; }
  begin(): GateAttempt {
    if (!this.#active) throw new Error("The wallet gate is closed.");
    const ready = this.cancel();
    const attempt: GateAttempt = new GateAttempt(ready, () => this.#active && this.#current === attempt,
      () => { if (this.#current === attempt) this.#current = undefined; }, (work) => this.#hold(work));
    this.#current = attempt;
    return attempt;
  }
  cancel(): Promise<void> {
    const previous = this.#current;
    this.#current = undefined;
    if (previous) this.#hold(previous.close());
    return this.#draining;
  }
  #hold(work: Promise<void>): void {
    this.#draining = Promise.all([this.#draining, work]).then(() => {});
    void this.#draining.catch(() => {});
  }
  stop(): Promise<void> { this.#active = false; return this.cancel(); }
}
