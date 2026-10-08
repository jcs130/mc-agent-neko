import test from 'node:test';
import assert from 'node:assert/strict';
import { readInventoryBook } from '../src/agent/library/books.js';

const botWith = item => ({ inventory: { slots: [null, item] } });
test('reads 1.20.6 written book components, including NBT chat text, without game actions', () => {
    const item = { name: 'written_book', components: [{ type: 'written_book_content', data: {
        rawTitle: '新手指南', author: 'Server', pages: [{ content: { type: 'compound', value: {
            text: { type: 'string', value: '欢迎！' }, extra: { type: 'list', value: {
                type: 'compound', value: [{ text: { type: 'string', value: '使用 /help 查看玩法。' } }],
            } },
        } } }],
    } }] };
    const bot = botWith(item);
    const before = structuredClone(bot);
    const result = readInventoryBook(bot);
    assert.match(result, /新手指南/);
    assert.match(result, /欢迎！使用 \/help 查看玩法。/);
    assert.deepEqual(bot, before);
});
test('supports legacy NBT JSON pages and writable book rawContent', () => {
    const legacy = { name: 'written_book', nbt: { type: 'compound', value: {
        title: { type: 'string', value: 'Rules' },
        pages: { type: 'list', value: { type: 'string', value: ['{"text":"Respect builds"}'] } },
    } } };
    assert.match(readInventoryBook(botWith(legacy), 1), /Respect builds/);
    const writable = { name: 'writable_book', components: [{ type: 'writable_book_content',
        data: { pages: [{ content: 'Notes' }] } }] };
    assert.match(readInventoryBook(botWith(writable)), /Notes/);
});
test('reports missing content honestly and caps model input', () => {
    assert.match(readInventoryBook(botWith({ name: 'written_book' })), /has not supplied/);
    assert.match(readInventoryBook(botWith(null)), /No readable/);
    assert.match(readInventoryBook(botWith(null), 99), /Invalid/);
    const item = { name: 'written_book', components: [{ type: 'written_book_content', data: {
        pages: Array.from({ length: 100 }, () => ({ content: 'a'.repeat(10000) })),
    } }] };
    const output = readInventoryBook(botWith(item));
    assert(output.length < 10500);
    assert.match(output, /first 8 pages/);
});
test('reads later pages by their actual page numbers without repeating the beginning', () => {
    const item = { name: 'written_book', components: [{ type: 'written_book_content', data: {
        pages: Array.from({ length: 23 }, (_, index) => ({ content: `Entry ${index + 1}.` })),
    } }] };
    const output = readInventoryBook(botWith(item), -1, 9);
    assert.match(output, /\[Page 9\] Entry 9\./);
    assert.match(output, /\[Page 16\] Entry 16\./);
    assert.doesNotMatch(output, /\[Page 1\]/);
    assert.match(output, /readBookPages\(-1, 17\)/);
    assert.match(readInventoryBook(botWith(item), -1, 17), /\[Page 23\]/);
    assert.match(readInventoryBook(botWith(item), -1, 24), /Invalid starting page/);
});
