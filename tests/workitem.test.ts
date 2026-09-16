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


// ---- "Assigned to me" filtering ----
import { isAssignedTo, WorkItem } from '../src/workitem';

function wi(over: Partial<WorkItem>): WorkItem {
    return {
        link: '1', file: null, id: '1', title: 't', type: 'Task', state: 'New',
        epic: '', labels: [], assignee: '', initials: '', points: '',
        sprint: '', area: '', parent: '', azure: '', ...over,
    };
}

const me = wi({ assignee: 'Isaac Obella', initials: 'IO' });
const other = wi({ assignee: 'Elizabeth Nakooli', initials: 'EN' });
const none = wi({});

check('story assigned to me matches', isAssignedTo('Isaac Obella', me, []));
check('match is case-insensitive', isAssignedTo('isaac obella', me, []));
check('initials also match', isAssignedTo('IO', me, []));
check('story of someone else does not match', !isAssignedTo('Isaac Obella', other, []));
check('unassigned story does not match', !isAssignedTo('Isaac Obella', none, []));
check('my work item pulls in an unassigned story',
    isAssignedTo('Isaac Obella', none, [other, me]));
check("someone else's work items do not match",
    !isAssignedTo('Isaac Obella', none, [other, none]));
check('empty name never matches', !isAssignedTo('', me, [me]));
check('blank name never matches', !isAssignedTo('   ', me, [me]));

if (failures === 0) {
    console.debug('\n  ALL OK (incl. assignee filter)');
} else {
    console.error(`\n  ${failures} FAILURE(S)`);
    throw new Error(`${failures} work item test failure(s)`);
}
