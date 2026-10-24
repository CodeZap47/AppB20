import { t, table } from 'spacetimedb/server';

/** Sincronización Moodle → calendario: identidad técnica del Worker y miembro al que se atribuyen las tareas. */
export const moodleSyncConfig = table({ name: 'moodle_sync_config' }, {
  id: t.u32().primaryKey(), identity: t.identity(), actor: t.identity(), enabled: t.bool(),
});
/** Tarea de Moodle (`cesun:assign:<id>`) ya importada; recuerda lo último que dijo Moodle, no lo que editó el grupo. */
export const moodleAssignmentLink = table({ name: 'moodle_assignment_link' }, {
  moodleId: t.string().primaryKey(), assignmentId: t.u64(), lastTitle: t.string(), lastDueDate: t.string(),
  createdAt: t.timestamp(), updatedAt: t.timestamp(),
});

export const moodleTables = { moodleSyncConfig, moodleAssignmentLink };
