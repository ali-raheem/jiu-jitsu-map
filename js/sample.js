// A small example game so first-time users see how a map fits together.

import { newMap, uid } from './store.js';

export function sampleMap() {
  const map = newMap('Example: closed guard game');
  map.notes = 'An example to explore. Edit it, or create your own map from the ⋯ menu.';

  const S = {};
  const M = {};
  const state = (key, name, category, notes, micros = []) => {
    const st = { id: uid('s'), name, category, notes, micro: [] };
    for (const [mk, mname, mnotes = ''] of micros) {
      const m = { id: uid('u'), name: mname, notes: mnotes };
      st.micro.push(m);
      M[mk] = m.id;
    }
    S[key] = st.id;
    map.states.push(st);
  };
  const ref = (s, m = null) => ({ state: S[s], micro: m ? M[m] : null });
  const T = {};
  const tech = (key, name, type, status, from, to, extra = {}) => {
    const t = { id: uid('t'), name, type, status, from, to, failsTo: null, failNotes: '', backups: [], notes: '', link: '', ...extra };
    T[key] = t;
    map.transitions.push(t);
  };

  state('stand', 'Standing', 'neutral', 'Grip fight first.', [
    ['collar', 'Collar & sleeve'],
    ['stiff', 'Opponent stiff-arming', 'Break the grip before pulling.'],
  ]);
  state('cg', 'Closed guard', 'bottom', 'Break posture before attacking.', [
    ['broken', 'Posture broken', 'Head below my chest, collar grip in.'],
    ['postured', 'Opponent postured up'],
  ]);
  state('half', 'Half guard', 'bottom', '', [
    ['shield', 'Knee shield'],
    ['under', 'Underhook', 'Win the underhook or lose the position.'],
  ]);
  state('side', 'Side control (bottom)', 'bottom', 'Frames first, then hip escape.', [
    ['cross', 'Opponent has crossface'],
  ]);
  state('mount', 'Mount', 'top', '', [
    ['high', 'High mount'],
    ['low', 'Low mount, grapevines'],
  ]);
  state('back', 'Back control', 'top', '', [
    ['belt', 'Seatbelt + hooks'],
  ]);

  tech('pull', 'Guard pull', 'guardpull', 'agame', ref('stand', 'collar'), ref('cg'));
  tech('rnc', 'Rear naked choke', 'submission', 'agame', ref('back', 'belt'), null,
    { failsTo: ref('back', 'belt'), failNotes: 'They defend the choking hand.' });
  tech('bow', 'Bow & arrow choke', 'submission', 'learning', ref('back', 'belt'), null);
  tech('kimura', 'Kimura', 'submission', 'working', ref('cg', 'postured'), null,
    { failsTo: ref('cg', 'postured'), notes: 'Comes up when they post a hand.' });
  tech('hip', 'Hip bump sweep', 'sweep', 'agame', ref('cg', 'postured'), ref('mount', 'low'),
    { failsTo: ref('cg', 'postured'), failNotes: 'They post their hand behind.', backups: [] });
  tech('scissor', 'Scissor sweep', 'sweep', 'working', ref('cg', 'broken'), ref('mount', 'low'),
    { failsTo: ref('half', 'shield') });
  tech('armbar', 'Armbar from guard', 'submission', 'failing', ref('cg', 'broken'), null,
    { failsTo: ref('side', 'cross'), failNotes: 'They stack me and pass. Angle is too shallow.' });
  tech('triangle', 'Triangle', 'submission', 'learning', ref('cg', 'broken'), null,
    { failsTo: ref('cg', 'postured'), notes: 'Shoot when they pull the arm out of the armbar.' });
  tech('shrimp', 'Shrimp to half guard', 'escape', 'working', ref('side', 'cross'), ref('half', 'shield'));
  tech('dog', 'Dogfight to back take', 'backtake', 'learning', ref('half', 'under'), ref('back', 'belt'),
    { failsTo: ref('half', 'shield'), failNotes: 'They whizzer and flatten me.' });
  tech('get', 'Win underhook', 'setup', 'working', ref('half', 'shield'), ref('half', 'under'));
  tech('mtarm', 'Armbar from mount', 'submission', 'working', ref('mount', 'high'), null,
    { failsTo: ref('cg', 'postured'), failNotes: 'They stack and I fall back into their guard.' });
  tech('turn', 'Take the back when they turn', 'backtake', 'agame', ref('mount', 'low'), ref('back', 'belt'));

  T.hip.backups = [T.kimura.id];
  T.armbar.backups = [T.triangle.id, T.shrimp.id];
  T.rnc.backups = [T.bow.id];
  T.mtarm.backups = [T.hip.id];
  T.dog.backups = [T.get.id];
  return map;
}
