import { MarkdownParser } from '../src/parser';
import { parseCard } from '../src/workitem';

const board = `---
title: Azure Board
lanes:
  - In Progress
---

# Azure Board

## In Progress

- [[2305|Tech Debt]]
  - [[2629|GitHub Issues FE]]
  - [[2630|GitHub Issues BE]]

- [[2759|Evidence Capture]]
`;

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
    if (cond) console.debug(`  PASS  ${name}`);
    else { failures++; console.error(`  FAIL  ${name}`, detail ?? ''); }
}

const parsed = MarkdownParser.parse(board);
const lane = parsed.lanes[0];
check('one lane parsed', parsed.lanes.length === 1, parsed.lanes.map(l => l.title));
check('two cards in lane', lane?.cards.length === 2, lane?.cards.length);

const first = lane?.cards[0];
console.debug('  raw card content:', JSON.stringify(first?.content));

const { primary, children } = parseCard(first?.content ?? '');
check('primary is the story link', primary === '[[2305|Tech Debt]]', primary);
check('two work items detected', children.length === 2, children);
check('first work item link', children[0] === '[[2629|GitHub Issues FE]]', children[0]);

const second = parseCard(lane?.cards[1]?.content ?? '');
check('card with no children', second.children.length === 0, second.children);

if (failures === 0) {
    console.debug('\n  ALL OK');
} else {
    console.error(`\n  ${failures} FAILURE(S)`);
    throw new Error(`${failures} work item test failure(s)`);
}
