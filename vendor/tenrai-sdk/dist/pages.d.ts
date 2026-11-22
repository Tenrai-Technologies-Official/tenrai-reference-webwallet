/**
 * Walks a paged route until its last page. String cursors in `next_cursor` need only `read`; other
 * cursors are typed at the parameter and named by `next`:
 * `pages((before?: number) => client.cuts.list({ before }), (page) => page.next_before)`.
 */
export declare function pages<Page extends {
    next_cursor: Cursor | null;
}, Cursor = string>(read: (cursor: Cursor | undefined) => Promise<Page>): AsyncGenerator<Page>;
export declare function pages<Page, Cursor = string>(read: (cursor: Cursor | undefined) => Promise<Page>, next: (page: Page) => Cursor | null | undefined): AsyncGenerator<Page>;
