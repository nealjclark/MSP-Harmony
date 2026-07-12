import assert from 'node:assert/strict';
import {
  formatLaborFilterSummary,
  laborFilterMatchesTicket,
  laborFilterSpecificity,
  selectLaborMappingForTicket,
  sumDistinctTicketHours,
} from './laborMappings';

const sampleTicket = {
  ticketId: 583852,
  boardId: 77,
  typeId: 1008,
  subTypeId: 4064,
  actualHours: 0.22,
};

assert.equal(
  laborFilterMatchesTicket({ boardId: 77, typeIds: [1008, 1009], subTypeIds: [4064] }, sampleTicket),
  true,
);
assert.equal(laborFilterMatchesTicket({ boardId: 77, typeIds: [1009] }, sampleTicket), false);
assert.equal(laborFilterMatchesTicket({ boardId: 77, typeIds: [], subTypeIds: [] }, sampleTicket), true);
assert.equal(laborFilterMatchesTicket({ typeIds: [1008, 2000] }, sampleTicket), true);
assert.equal(laborFilterMatchesTicket({ subTypeIds: [1, 2] }, sampleTicket), false);

assert.equal(laborFilterSpecificity({}), 0);
assert.equal(laborFilterSpecificity({ boardId: 77, typeIds: [1008], subTypeIds: [4064, 4065] }), 7);

const selected = selectLaborMappingForTicket(
  [
    { label: 'Backup board', boardId: 77, typeIds: [], subTypeIds: [], priority: 10, active: true },
    {
      label: 'Datto BCDR',
      boardId: 77,
      typeIds: [1008, 1010],
      subTypeIds: [4064],
      priority: 20,
      active: true,
    },
  ],
  sampleTicket,
);
assert.equal(selected?.label, 'Datto BCDR');

assert.equal(
  sumDistinctTicketHours([
    sampleTicket,
    { ticketId: 583852, actualHours: 0.22 },
    { ticketId: 1, actualHours: 1.5 },
  ]),
  1.72,
);

assert.equal(
  formatLaborFilterSummary({
    boardId: 77,
    boardName: 'Backup',
    typeIds: [1008, 1009],
    typeNames: ['Backup Management', 'Backup Restore'],
    subTypeIds: [],
  }),
  'Backup / Backup Management, Backup Restore / Any subtype',
);

console.log('labor mapping tests passed');
