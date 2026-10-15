// E-Learning: the learner's side of quiz and assignment lessons (loaded by the lesson page after elearning.js).
//   <el-quiz :quiz :mine :url @progress>              take a quiz, see the result and review attempts
//   <el-assignment :assignment :mine :url @progress>  hand in an answer and / or a file, see the grade and feedback
(function () {
  'use strict';
  if (!window.Vue || !window.ELearn) return;

  var shuffle = function (list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  var QTYPE_HINT = { single: 'Choose one answer', multiple: 'Choose all that apply', truefalse: 'True or false', short: 'Type your answer' };

  Vue.component('el-quiz', {
    props: { quiz: Object, mine: Object, url: String },
    data: function () {
      return { stage: 'intro', questions: [], answers: {}, result: null, mineNow: this.mine, busy: false, error: '', confirmUnanswered: false, QTYPE_HINT: QTYPE_HINT };
    },
    computed: {
      left: function () { return this.quiz.maxAttempts ? Math.max(0, this.quiz.maxAttempts - this.mineNow.count) : Infinity; },
      answered: function () {
        var a = this.answers;
        return this.questions.filter(function (q) { var v = a[q.id]; return Array.isArray(v) ? v.length : v != null && String(v).trim() !== ''; }).length;
      },
      byId: function () { var m = {}; this.quiz.questions.forEach(function (q) { m[q.id] = q; }); return m; },
      reviewList: function () {
        var self = this;
        return this.result ? this.result.review.map(function (r) { return { r: r, q: self.byId[r.id] }; }).filter(function (x) { return x.q; }) : [];
      },
      correctCount: function () { return this.reviewList.filter(function (x) { return x.r.ok; }).length; }
    },
    template:
      '<div class="el-quiz">' +
        // intro
        '<div v-if="stage === \'intro\'" class="el-qcard">' +
          '<div class="el-qstats">' +
            '<div><small>Questions</small><b>{{ quiz.questions.length }}</b></div>' +
            '<div><small>Pass mark</small><b>{{ quiz.passPct }}%</b></div>' +
            '<div><small>Attempts</small><b>{{ mineNow.count }}<template v-if="quiz.maxAttempts"> / {{ quiz.maxAttempts }}</template></b></div>' +
            '<div><small>Best score</small><b>{{ mineNow.best == null ? \'—\' : mineNow.best + \'%\' }}</b></div>' +
          '</div>' +
          '<div v-if="mineNow.passed" class="el-msg is-ok"><i class="fas fa-check-circle"></i><span>You passed this quiz. You can take it again<template v-if="quiz.maxAttempts"> while you have attempts left</template>; your best result counts.</span></div>' +
          '<div v-else-if="mineNow.count && !left" class="el-msg is-error"><i class="fas fa-ban"></i><span>You have used all {{ quiz.maxAttempts }} attempts without passing. Ask the course manager if you need another try.</span></div>' +
          '<div v-else-if="mineNow.last" class="el-msg is-info"><i class="fas fa-info-circle"></i><span>Your last attempt scored {{ mineNow.last.pct }}%; you need {{ quiz.passPct }}% to pass.</span></div>' +
          '<div class="el-qactions">' +
            '<button type="button" class="el-btn is-primary is-lg" :disabled="!left" @click="start"><i class="fas fa-play" aria-hidden="true"></i> {{ mineNow.count ? \'Retake quiz\' : \'Start quiz\' }}</button>' +
            '<button v-if="mineNow.last" type="button" class="el-btn is-lg" :disabled="busy" @click="reviewLast"><i class="fas fa-search" aria-hidden="true"></i> Review last attempt</button>' +
            '<span v-if="quiz.maxAttempts && left && left !== Infinity" class="el-muted" style="font-size: 13px;">{{ left }} attempt{{ left === 1 ? \'\' : \'s\' }} left</span>' +
          '</div>' +
          '<table v-if="mineNow.attempts && mineNow.attempts.length > 1" class="el-table" style="margin-top: 4px;">' +
            '<thead><tr><th>Attempt</th><th>Score</th><th>Result</th><th>Date</th></tr></thead>' +
            '<tbody><tr v-for="(a, i) in mineNow.attempts" :key="a.id"><td>#{{ mineNow.count - i }}</td><td>{{ a.pct }}% <small class="el-muted">({{ a.score }}/{{ a.max }})</small></td>' +
              '<td><span class="el-badge" :class="a.passed ? \'is-done\' : \'is-draft\'">{{ a.passed ? \'Passed\' : \'Not passed\' }}</span></td><td>{{ when(a.at) }}</td></tr></tbody>' +
          '</table>' +
        '</div>' +

        // taking
        '<form v-else-if="stage === \'taking\'" class="el-qtake" @submit.prevent="submit(false)">' +
          '<div class="el-qprogress"><span>{{ answered }} of {{ questions.length }} answered</span><span class="el-bar"><span :style="{ width: (answered * 100 / questions.length) + \'%\' }"></span></span></div>' +
          '<fieldset v-for="(q, i) in questions" :key="q.id" class="el-q">' +
            '<legend class="el-q-head"><span>Question {{ i + 1 }}</span><small>{{ QTYPE_HINT[q.type] }} · {{ q.points }} point{{ q.points === 1 ? \'\' : \'s\' }}</small></legend>' +
            '<div class="el-md el-q-text" v-html="md(q.text)"></div>' +
            '<div v-if="q.type === \'short\'"><input class="el-input" v-model="answers[q.id]" :aria-label="\'Answer to question \' + (i + 1)" placeholder="Your answer" maxlength="500"></div>' +
            '<div v-else class="el-opts">' +
              '<label v-for="o in q.options" :key="o.id" class="el-opt" :class="{ \'is-on\': picked(q, o) }">' +
                '<input v-if="q.type === \'multiple\'" type="checkbox" :value="o.id" v-model="answers[q.id]">' +
                '<input v-else type="radio" :name="\'q-\' + q.id" :value="o.id" v-model="answers[q.id]">' +
                '<span>{{ o.text }}</span>' +
              '</label>' +
            '</div>' +
          '</fieldset>' +
          '<div v-if="error" class="el-msg is-error" role="alert"><i class="fas fa-exclamation-triangle"></i><span>{{ error }}</span></div>' +
          '<div v-if="confirmUnanswered" class="el-msg is-info" role="alert"><i class="fas fa-question-circle"></i><span>{{ questions.length - answered }} question{{ questions.length - answered === 1 ? \' is\' : \'s are\' }} not answered and will count as wrong. ' +
            '<button type="button" class="el-link" @click="submit(true)">Submit anyway</button></span></div>' +
          '<div class="el-qactions is-end">' +
            '<button type="button" class="el-btn is-ghost" @click="stage = \'intro\'">Cancel</button>' +
            '<button type="submit" class="el-btn is-primary is-lg" :disabled="busy"><i :class="busy ? \'fas fa-spinner fa-spin\' : \'fas fa-paper-plane\'" aria-hidden="true"></i> Submit answers</button>' +
          '</div>' +
        '</form>' +

        // result / review
        '<div v-else class="el-qresult">' +
          '<div class="el-qscore" :class="result.attempt.passed ? \'is-pass\' : \'is-fail\'">' +
            '<div class="el-ring" :style="{ \'--p\': result.attempt.pct }"><b>{{ result.attempt.pct }}%</b></div>' +
            '<div><h3>{{ result.attempt.passed ? \'Passed!\' : \'Not passed yet\' }}</h3>' +
              '<p>{{ result.attempt.score }} of {{ result.attempt.max }} points · {{ correctCount }} of {{ reviewList.length }} correct · pass mark {{ quiz.passPct }}%</p>' +
              '<p v-if="!quiz.showAnswers" class="el-muted">The correct answers are not shown for this quiz.</p></div>' +
          '</div>' +
          '<div v-for="(x, i) in reviewList" :key="x.q.id" class="el-q is-review" :class="x.r.ok ? \'is-right\' : \'is-wrong\'">' +
            '<div class="el-q-head"><span><i :class="x.r.ok ? \'fas fa-check-circle\' : \'fas fa-times-circle\'" aria-hidden="true"></i> Question {{ i + 1 }}</span><small>{{ x.r.ok ? \'Correct\' : \'Incorrect\' }}</small></div>' +
            '<div class="el-md el-q-text" v-html="md(x.q.text)"></div>' +
            '<div v-if="x.q.type === \'short\'" class="el-q-short">' +
              '<div>Your answer: <b>{{ x.r.answer || \'(no answer)\' }}</b></div>' +
              '<div v-if="x.r.accepted && !x.r.ok">Accepted: <b>{{ x.r.accepted.join(\' / \') }}</b></div>' +
            '</div>' +
            '<div v-else class="el-opts">' +
              '<div v-for="o in x.q.options" :key="o.id" class="el-opt is-static" :class="optClass(x, o)">' +
                '<i :class="optIcon(x, o)" aria-hidden="true"></i><span>{{ o.text }}</span>' +
                '<small v-if="chosen(x, o)">your answer</small>' +
              '</div>' +
            '</div>' +
            '<div v-if="x.r.explain" class="el-q-explain"><i class="far fa-lightbulb" aria-hidden="true"></i><div class="el-md" v-html="md(x.r.explain)"></div></div>' +
          '</div>' +
          '<div class="el-qactions">' +
            '<button v-if="left" type="button" class="el-btn is-primary" @click="start"><i class="fas fa-redo" aria-hidden="true"></i> Retake quiz</button>' +
            '<button type="button" class="el-btn" @click="stage = \'intro\'; result = null">Back to the quiz</button>' +
          '</div>' +
        '</div>' +
      '</div>',
    methods: {
      md: ELearn.md, when: ELearn.when,
      start: function () {
        var shuffleOn = this.quiz.shuffle, answers = {};
        this.questions = (shuffleOn ? shuffle(this.quiz.questions) : this.quiz.questions).map(function (q) {
          answers[q.id] = q.type === 'multiple' ? [] : q.type === 'short' ? '' : null;
          return Object.assign({}, q, { options: q.options && shuffleOn && q.type !== 'truefalse' ? shuffle(q.options) : q.options });
        });
        this.answers = answers;
        this.error = '';
        this.confirmUnanswered = false;
        this.result = null;
        this.stage = 'taking';
        this.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      picked: function (q, o) { var v = this.answers[q.id]; return Array.isArray(v) ? v.indexOf(o.id) >= 0 : v === o.id; },
      submit: function (force) {
        if (!force && this.answered < this.questions.length) { this.confirmUnanswered = true; return; }
        var self = this;
        this.busy = true;
        this.error = '';
        this.confirmUnanswered = false;
        ELearn.post(this.url, { answers: this.answers })
          .then(function (r) {
            self.result = r;
            self.mineNow = r.mine;
            self.stage = 'result';
            if (r.progress) self.$emit('progress', r.progress);
            self.$nextTick(function () { self.$el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
          })
          .catch(function (err) { self.error = err.message; })
          .finally(function () { self.busy = false; });
      },
      reviewLast: function () {
        var self = this;
        this.busy = true;
        ELearn.getJson(this.url + '/attempts/' + this.mineNow.last.id)
          .then(function (r) { self.result = r; self.stage = 'result'; })
          .catch(function (err) { self.error = err.message; })
          .finally(function () { self.busy = false; });
      },
      chosen: function (x, o) { var a = x.r.answer; return Array.isArray(a) ? a.indexOf(o.id) >= 0 : a === o.id; },
      isCorrect: function (x, o) { return !!x.r.correct && x.r.correct.indexOf(o.id) >= 0; },
      optClass: function (x, o) {
        if (this.isCorrect(x, o)) return 'is-right';
        if (this.chosen(x, o)) return x.r.correct || !x.r.ok ? 'is-wrong' : 'is-on';
        return '';
      },
      optIcon: function (x, o) {
        if (this.isCorrect(x, o)) return 'fas fa-check';
        if (this.chosen(x, o)) return x.r.ok && !x.r.correct ? 'fas fa-dot-circle' : 'fas fa-times';
        return 'far fa-circle';
      }
    }
  });

  Vue.component('el-assignment', {
    props: { assignment: Object, mine: Object, url: String },
    data: function () {
      var latest = this.mine.latest;
      return { mineNow: this.mine, text: latest && latest.status === 'submitted' ? latest.text || '' : '', file: null, keepFile: true, editing: !latest, busy: false, error: '', notice: '' };
    },
    computed: {
      a: function () { return this.assignment; },
      latest: function () { return this.mineNow.latest; },
      accept: function () { return this.a.fileTypes.join(','); },
      status: function () {
        var l = this.latest;
        if (!l) return { cls: 'is-new', icon: 'far fa-circle', text: 'Not submitted yet' };
        if (l.status === 'submitted') return { cls: 'is-wait', icon: 'far fa-clock', text: 'Submitted, waiting for grading' };
        return l.passed ? { cls: 'is-pass', icon: 'fas fa-check-circle', text: 'Passed' } : { cls: 'is-fail', icon: 'fas fa-redo', text: 'Needs another try' };
      }
    },
    template:
      '<div class="el-assign">' +
        '<ul class="el-meta el-assign-rules">' +
          '<li><i class="fas fa-star" aria-hidden="true"></i>{{ a.maxPoints }} points · pass at {{ a.passPoints }}</li>' +
          '<li v-if="a.allowText"><i class="fas fa-keyboard" aria-hidden="true"></i>Written answer</li>' +
          '<li v-if="a.allowFile"><i class="fas fa-paperclip" aria-hidden="true"></i>File up to {{ a.maxFileMb }} MB</li>' +
          '<li><i class="fas fa-redo" aria-hidden="true"></i>{{ a.resubmit ? \'Can resubmit after a failing grade\' : \'One graded submission\' }}</li>' +
        '</ul>' +

        '<div class="el-qcard">' +
          '<div class="el-assign-status" :class="status.cls"><i :class="status.icon" aria-hidden="true"></i><b>{{ status.text }}</b>' +
            '<span v-if="latest && latest.status === \'graded\'" class="el-assign-score">{{ latest.score }} / {{ a.maxPoints }}</span></div>' +

          '<template v-if="latest">' +
            '<div v-if="latest.status === \'graded\'" class="el-assign-feedback">' +
              '<small>Feedback from {{ latest.gradedBy || \'the grader\' }} · {{ when(latest.gradedAt) }}</small>' +
              '<div v-if="latest.feedback" class="el-md" v-html="md(latest.feedback)"></div><p v-else class="el-muted">No written feedback.</p>' +
            '</div>' +
            '<div v-if="!editing" class="el-assign-sub">' +
              '<small>Your submission · {{ when(latest.submittedAt) }}<template v-if="mineNow.count > 1"> · submission {{ mineNow.count }}</template></small>' +
              '<div v-if="latest.text" class="el-assign-text">{{ latest.text }}</div>' +
              '<a v-if="latest.file" class="el-file" :href="latest.file.url"><i class="far fa-file" aria-hidden="true"></i>{{ latest.file.name }} <small>{{ size(latest.file.size) }}</small></a>' +
            '</div>' +
          '</template>' +

          '<div v-if="notice" class="el-msg is-ok" role="status"><i class="fas fa-check-circle"></i><span>{{ notice }}</span></div>' +

          '<div v-if="a.guestBlocked" class="el-msg is-info"><i class="fas fa-info-circle"></i><span>Assignments of this shared course are handed in by signed-in staff only. Read the instructions above; ask the course\'s instructor how to hand it in.</span></div>' +
          '<form v-else-if="editing && mineNow.canSubmit" class="el-assign-form" @submit.prevent="submit">' +
            '<label v-if="a.allowText" class="el-field">Your answer' +
              '<textarea v-model="text" class="el-input" rows="8" maxlength="100000" placeholder="Write your answer here…"></textarea></label>' +
            '<div v-if="a.allowFile" class="el-field">Attach a file <small>{{ a.fileTypes.join(\' \') }} · up to {{ a.maxFileMb }} MB</small>' +
              '<div class="el-inline" style="align-items: center; flex-wrap: wrap;">' +
                '<label class="el-btn" style="margin: 0;"><input type="file" class="sr-only" :accept="accept" @change="pick"><i class="fas fa-paperclip" aria-hidden="true"></i> {{ file ? \'Change file\' : \'Choose file\' }}</label>' +
                '<span v-if="file" class="el-file is-static"><i class="far fa-file" aria-hidden="true"></i>{{ file.name }} <small>{{ size(file.size) }}</small>' +
                  '<button type="button" class="el-icon-btn" title="Remove" @click="file = null"><i class="fas fa-times" aria-hidden="true"></i></button></span>' +
                '<label v-else-if="latest && latest.status === \'submitted\' && latest.file" class="el-check" style="margin: 0;"><input type="checkbox" v-model="keepFile"><span>Keep {{ latest.file.name }}</span></label>' +
              '</div>' +
            '</div>' +
            '<div v-if="error" class="el-msg is-error" role="alert"><i class="fas fa-exclamation-triangle"></i><span>{{ error }}</span></div>' +
            '<div class="el-qactions">' +
              '<button type="submit" class="el-btn is-primary" :disabled="busy"><i :class="busy ? \'fas fa-spinner fa-spin\' : \'fas fa-paper-plane\'" aria-hidden="true"></i> {{ latest && latest.status === \'submitted\' ? \'Update submission\' : \'Submit\' }}</button>' +
              '<button v-if="latest" type="button" class="el-btn is-ghost" @click="editing = false; error = \'\'">Cancel</button>' +
            '</div>' +
          '</form>' +
          '<div v-else-if="mineNow.canSubmit && !a.guestBlocked" class="el-qactions">' +
            '<button type="button" class="el-btn" :class="latest && latest.status === \'graded\' ? \'is-primary\' : \'\'" @click="edit"><i class="fas fa-pen" aria-hidden="true"></i> {{ latest && latest.status === \'graded\' ? \'Submit again\' : \'Edit submission\' }}</button>' +
          '</div>' +

          '<details v-if="mineNow.history && mineNow.history.length" class="el-assign-history"><summary>Earlier submissions ({{ mineNow.history.length }})</summary>' +
            '<ul><li v-for="h in mineNow.history" :key="h.id">{{ when(h.submittedAt) }} · <template v-if="h.status === \'graded\'">{{ h.score }}/{{ a.maxPoints }} {{ h.passed ? \'passed\' : \'not passed\' }}</template><template v-else>not graded</template>' +
              '<a v-if="h.file" :href="h.file.url" style="margin-left: 6px;">{{ h.file.name }}</a></li></ul>' +
          '</details>' +
        '</div>' +
      '</div>',
    methods: {
      md: ELearn.md, when: ELearn.when, size: ELearn.size,
      edit: function () {
        var l = this.latest;
        this.text = l && l.status === 'submitted' ? l.text || '' : '';
        this.file = null;
        this.keepFile = true;
        this.notice = '';
        this.editing = true;
      },
      pick: function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        this.error = '';
        if (!f) return;
        var ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
        if (this.a.fileTypes.indexOf(ext) < 0) { this.error = 'This type of file can\'t be handed in. Allowed: ' + this.a.fileTypes.join(' '); return; }
        if (f.size > this.a.maxFileMb * 1024 * 1024) { this.error = 'The file is larger than ' + this.a.maxFileMb + ' MB.'; return; }
        this.file = f;
      },
      read: function (f) {
        return new Promise(function (resolve, reject) {
          var r = new FileReader();
          r.onload = function () { resolve(r.result); };
          r.onerror = function () { reject(new Error('The file could not be read.')); };
          r.readAsDataURL(f);
        });
      },
      submit: function () {
        var self = this;
        this.busy = true;
        this.error = '';
        (this.file ? this.read(this.file) : Promise.resolve(null))
          .then(function (data) {
            return ELearn.post(self.url, { text: self.text, file: data ? { name: self.file.name, data: data } : null, keepFile: self.keepFile }, true);
          })
          .then(function (r) {
            self.mineNow = r.mine;
            self.editing = false;
            self.file = null;
            self.notice = 'Submitted. You\'ll see your grade and feedback here once it is graded.';
          })
          .catch(function (err) { self.error = err.message; })
          .finally(function () { self.busy = false; });
      }
    }
  });
})();
