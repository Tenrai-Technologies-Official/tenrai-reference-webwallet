/**
 * Iterate until the last page. `next_cursor` is the default cursor.
 * Supply a cursor extractor for other pagination formats.
 */
export declare function pages<Page extends {
    next_cursor: Cursor | null;
}, Cursor = string>(read: (cursor: Cursor | undefined) => Promise<Page>): AsyncGenerator<Page>;
export declare function pages<Page, Cursor = string>(read: (cursor: Cursor | undefined) => Promise<Page>, next: (page: Page) => Cursor | null | undefined): AsyncGenerator<Page>;
