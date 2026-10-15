// E-Learning course editor: quiz and assignment lessons (loaded by the editor page after elearning.js).
//   ELearnBuilder.defaults(type)     new settings for a quiz / assignment
//   ELearnBuilder.check(type, s)     what is missing before the lesson can be kept ('' when fine)
//   <el-quiz-builder :settings>      questions and quiz rules (edits the settings object in place)
//   <el-assignment-builder :settings> points, what learners hand in, resubmission
(function () {
  'use strict';
  if (!window.Vue) return;

  var rid = function () { return Math.random().toString(36).slice(2, 10); };
  var QTYPES = [
    { key: 'single', label: 'Single choice', icon: 'far fa-dot-circle' },
    { key: 'multiple', label: 'Multiple choice', icon: 'far fa-check-square' },
    { key: 'truefalse', label: 'True or false', icon: 'fas fa-adjust' },
    { key: 'short', label: 'Short answer', icon: 'fas fa-font' }
  ];
  var trueFalse = function (isTrue) { return [{ id: 'true', text: 'True', correct: isTrue }, { id: 'false', text: 'False', correct: !isTrue }]; };
  var question = function (type) {
    var q = { id: rid(), type: type || 'single', text: '', points: 1, explain: '', options: [], answers: [] };
    if (q.type === 'truefalse') q.options = trueFalse(true);
    else if (q.type !== 'short') q.options = [{ id: rid(), text: '', correct: true }, { id: rid(), text: '', correct: false }];
    return q;
  };

  window.ELearnBuilder = {
    defaults: function (type) {
      if (type === 'quiz') return { passPct: 70, maxAttempts: 0, showAnswers: true, shuffle: false, questions: [question('single')] };
      if (type === 'assignment') return { maxPoints: 100, passPoints: 50, allowText: true, allowFile: true, maxFileMb: 10, resubmit: true };
      return {};
    },
    // Old or partial settings filled in, so the builders always have every field
    complete: function (type, s) {
      var d = this.defaults(type), out = Object.assign({}, d, s || {});
      if (type === 'quiz') {
        out.questions = (s && Array.isArray(s.questions) && s.questions.length ? s.questions : d.questions).map(function (q) {
          return Object.assign({ points: 1, explain: '', options: [], answers: [] }, q, { options: (q.options || []).map(function (o) { return Object.assign({}, o); }), answers: (q.answers || []).slice() });
        });
      }
      return out;
    },
    check: function (type, s) {
      if (type === 'assignment') {
        if (!s.allowText && !s.allowFile) return 'Allow a written answer, a file, or both.';
        if (+s.passPoints > +s.maxPoints) return 'The passing points can\'t be more than the maximum points.';
        return '';
      }
      if (type !== 'quiz') return '';
      if (!s.questions.length) return 'Add at least one question.';
      for (var i = 0; i < s.questions.length; i++) {
        var q = s.questions[i], at = 'Question ' + (i + 1) + ': ';
        if (!q.text.trim()) return at + 'write the question.';
        if (q.type === 'short') {
          if (!q.answers.some(function (a) { return String(a).trim(); })) return at + 'add at least one accepted answer.';
          continue;
        }
        var filled = q.options.filter(function (o) { return o.text.trim(); });
        if (filled.length < 2) return at + 'add at least two answer choices.';
        var right = filled.filter(function (o) { return o.correct; }).length;
        if (!right) return at + 'mark the correct answer.';
        if (q.type === 'single' && right > 1) return at + 'single choice can have only one correct answer.';
      }
      return '';
    }
  };

  Vue.component('el-quiz-builder', {
    props: { settings: Object },
    data: function () { return { QTYPES: QTYPES, open: {} }; },
    computed: {
      s: function () { return this.settings; },
      points: function () { return this.s.questions.reduce(function (n, q) { return n + (+q.points || 0); }, 0); }
    },
    template:
      '<div class="el-qb">' +
        '<div class="el-row">' +
          '<label class="el-field">Pass mark <small>% of the points</small>' +
            '<input v-model.number="s.passPct" type="number" min="0" max="100" class="el-input"></label>' +
          '<label class="el-field">Attempts allowed <small>0 = unlimited</small>' +
            '<input v-model.number="s.maxAttempts" type="number" min="0" max="100" class="el-input"></label>' +
          '<div class="el-field">After submitting' +
            '<label class="el-check"><input type="checkbox" v-model="s.showAnswers"><span>Show the correct answers</span></label>' +
            '<label class="el-check"><input type="checkbox" v-model="s.shuffle"><span>Shuffle questions and choices</span></label>' +
          '</div>' +
        '</div>' +
        '<div class="el-qb-head"><b>Questions</b><span class="el-muted">{{ s.questions.length }} question{{ s.questions.length === 1 ? \'\' : \'s\' }} · {{ points }} point{{ points === 1 ? \'\' : \'s\' }}</span></div>' +
        '<div v-for="(q, i) in s.questions" :key="q.id" class="el-qb-q">' +
          '<div class="el-qb-qhead">' +
            '<span class="el-b-num">Q{{ i + 1 }}</span>' +
            '<select class="el-select" :value="q.type" @change="setType(q, $event.target.value)" aria-label="Question type"><option v-for="t in QTYPES" :key="t.key" :value="t.key">{{ t.label }}</option></select>' +
            '<label class="el-qb-points"><input v-model.number="q.points" type="number" min="1" max="100" class="el-input" aria-label="Points"><span>pt</span></label>' +
            '<div class="el-b-tools">' +
              '<button type="button" class="el-icon-btn" title="Move up" :disabled="i === 0" @click="move(i, -1)"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>' +
              '<button type="button" class="el-icon-btn" title="Move down" :disabled="i === s.questions.length - 1" @click="move(i, 1)"><i class="fas fa-arrow-down" aria-hidden="true"></i></button>' +
              '<button type="button" class="el-icon-btn" title="Duplicate" @click="duplicate(i)"><i class="far fa-copy" aria-hidden="true"></i></button>' +
              '<button type="button" class="el-icon-btn is-danger" title="Delete question" :disabled="s.questions.length === 1" @click="s.questions.splice(i, 1)"><i class="far fa-trash-alt" aria-hidden="true"></i></button>' +
            '</div>' +
          '</div>' +
          '<textarea v-model="q.text" class="el-input" rows="2" maxlength="5000" placeholder="Question (Markdown allowed)" :aria-label="\'Question \' + (i + 1)"></textarea>' +

          '<div v-if="q.type === \'short\'" class="el-field">Accepted answers <small>one per line; not case-sensitive, extra spaces ignored</small>' +
            '<textarea class="el-input" rows="2" :value="q.answers.join(\'\\n\')" @input="q.answers = $event.target.value.split(\'\\n\')" placeholder="e.g. HN&#10;Hospital number"></textarea></div>' +

          '<div v-else-if="q.type === \'truefalse\'" class="el-qb-tf">' +
            '<span class="el-muted">Correct answer:</span>' +
            '<label v-for="o in q.options" :key="o.id" class="el-qb-opt-pill" :class="{ \'is-on\': o.correct }"><input type="radio" class="sr-only" :name="\'tf-\' + q.id" :checked="o.correct" @change="markOnly(q, o)">{{ o.text }}</label>' +
          '</div>' +

          '<div v-else class="el-qb-opts">' +
            '<div v-for="(o, k) in q.options" :key="o.id" class="el-qb-opt" :class="{ \'is-right\': o.correct }">' +
              '<label class="el-qb-mark" :title="o.correct ? \'Correct answer\' : \'Mark as correct\'">' +
                '<input v-if="q.type === \'single\'" type="radio" :name="\'q-\' + q.id" :checked="o.correct" @change="markOnly(q, o)">' +
                '<input v-else type="checkbox" v-model="o.correct">' +
                '<span class="sr-only">Correct</span></label>' +
              '<input v-model="o.text" class="el-input" maxlength="1000" :placeholder="\'Choice \' + (k + 1)">' +
              '<button type="button" class="el-icon-btn is-danger" title="Remove choice" :disabled="q.options.length <= 2" @click="q.options.splice(k, 1)"><i class="fas fa-times" aria-hidden="true"></i></button>' +
            '</div>' +
            '<div class="el-qb-optfoot"><button type="button" class="el-link" :disabled="q.options.length >= 12" @click="q.options.push({ id: rid(), text: \'\', correct: false })"><i class="fas fa-plus" aria-hidden="true"></i> Add choice</button>' +
              '<small class="el-muted">{{ q.type === \'single\' ? \'Select the one correct answer\' : \'Tick every correct answer; all must be chosen to score\' }}</small></div>' +
          '</div>' +

          '<button v-if="!q.explain && !open[q.id]" type="button" class="el-link el-qb-explain-add" @click="$set(open, q.id, true)"><i class="far fa-lightbulb" aria-hidden="true"></i> Add explanation</button>' +
          '<label v-else class="el-field">Explanation <small>shown with the answers after submitting</small>' +
            '<textarea v-model="q.explain" class="el-input" rows="2" maxlength="5000"></textarea></label>' +
        '</div>' +
        '<div class="el-b-add" style="padding: 0;">' +
          '<button v-for="t in QTYPES" :key="t.key" type="button" class="el-btn is-sm" @click="add(t.key)"><i :class="t.icon" aria-hidden="true"></i> {{ t.label }}</button>' +
        '</div>' +
      '</div>',
    methods: {
      rid: rid,
      add: function (type) { this.s.questions.push(question(type)); },
      move: function (i, d) { var q = this.s.questions.splice(i, 1)[0]; this.s.questions.splice(i + d, 0, q); },
      duplicate: function (i) {
        var q = JSON.parse(JSON.stringify(this.s.questions[i]));
        q.id = rid();
        if (q.type !== 'truefalse') q.options.forEach(function (o) { o.id = rid(); });
        this.s.questions.splice(i + 1, 0, q);
      },
      markOnly: function (q, o) { q.options.forEach(function (x) { x.correct = x === o; }); },
      setType: function (q, type) {
        var from = q.type;
        q.type = type;
        if (type === 'truefalse') q.options = trueFalse(true);
        else if (type === 'short') { if (!q.answers.length) q.answers = []; }
        else if (from === 'truefalse' || from === 'short' || !q.options.length) q.options = [{ id: rid(), text: '', correct: true }, { id: rid(), text: '', correct: false }];
        else if (type === 'single') {
          // keep the first correct answer only
          var seen = false;
          q.options.forEach(function (o) { if (o.correct && seen) o.correct = false; if (o.correct) seen = true; });
        }
      }
    }
  });

  Vue.component('el-assignment-builder', {
    props: { settings: Object },
    computed: { s: function () { return this.settings; } },
    template:
      '<div class="el-qb">' +
        '<div class="el-row">' +
          '<label class="el-field">Maximum points<input v-model.number="s.maxPoints" type="number" min="1" max="1000" class="el-input"></label>' +
          '<label class="el-field">Pass at <small>points or more</small><input v-model.number="s.passPoints" type="number" min="0" :max="s.maxPoints" class="el-input"></label>' +
          '<label class="el-field">Largest file <small>MB, up to 25</small><input v-model.number="s.maxFileMb" type="number" min="1" max="25" class="el-input" :disabled="!s.allowFile"></label>' +
        '</div>' +
        '<div class="el-field">Learners hand in' +
          '<label class="el-check"><input type="checkbox" v-model="s.allowText"><span>A written answer</span></label>' +
          '<label class="el-check"><input type="checkbox" v-model="s.allowFile"><span>A file (PDF, Office documents, images, ZIP…)</span></label>' +
        '</div>' +
        '<label class="el-check"><input type="checkbox" v-model="s.resubmit"><span>Learners can submit again after a failing grade</span></label>' +
        '<small class="el-field-note">Course managers grade submissions on the course\'s Grading page. A passing grade completes the lesson for the learner.</small>' +
      '</div>'
  });
})();
