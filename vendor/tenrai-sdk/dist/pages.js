export async function* pages(read, next = (page) => page.next_cursor) {
    let cursor;
    do {
        const page = await read(cursor);
        yield page;
        cursor = next(page) ?? undefined;
    } while (cursor !== undefined);
}
