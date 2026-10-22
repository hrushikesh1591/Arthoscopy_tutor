/**
 * TMJ Arthroscopy Micro-Tutor
 * Clinical Masterclass App Logic
 * Grounded in: Principles and Practice of TMJ Arthroscopy (McCain)
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State Management & LocalStorage Persistence
  // ---------------------------------------------------------------------------
  const STORAGE_KEYS = {
    PROGRESS: 'tmj_micro_tutor_progress_v1',
    QUIZ: 'tmj_micro_tutor_quiz_v1',
    FLASHCARDS: 'tmj_micro_tutor_fc_v1',
    THEME: 'tmj_micro_tutor_theme_v1',
    STREAK: 'tmj_micro_tutor_streak_v1'
  };

  let curriculumData = [];
  let currentChapter = null;
  let currentModule = null;
  let currentActiveTab = 'lesson';
  let currentFcIndex = 0;

  let isSpeaking = false;

  // Load saved state
  let progressState = JSON.parse(localStorage.getItem(STORAGE_KEYS.PROGRESS) || '{"completed": []}');
  let quizState = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUIZ) || '{"answers": {}}');
  let flashcardState = JSON.parse(localStorage.getItem(STORAGE_KEYS.FLASHCARDS) || '{"mastered": []}');

  // DOM Elements
  const curriculumNav = document.getElementById('curriculumNav');
  const searchInput = document.getElementById('searchInput');
  const partFilterBtns = document.querySelectorAll('.part-btn');
  const activeBreadcrumb = document.getElementById('activeBreadcrumb');
  const lessonContainer = document.getElementById('lessonContainer');
  const quizContainer = document.getElementById('quizContainer');
  const flashcardsContainer = document.getElementById('flashcardsContainer');
  const flashcardCountBadge = document.getElementById('flashcardCountBadge');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const toggleCompleteBtn = document.getElementById('toggleCompleteBtn');
  const copyTelegramBtn = document.getElementById('copyTelegramBtn');
  const listenAudioBtn = document.getElementById('listenAudioBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const resetProgressBtn = document.getElementById('resetProgressBtn');
  const streakCountEl = document.getElementById('streakCount');
  const mobileStreakCountEl = document.getElementById('mobileStreakCount');
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const closeSidebarBtn = document.getElementById('closeSidebarBtn');
  const sidebarDrawer = document.getElementById('sidebarDrawer');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const completedCountEl = document.getElementById('completedCount');
  const quizScorePctEl = document.getElementById('quizScorePct');
  const cardsMasteredEl = document.getElementById('cardsMastered');
  const toast = document.getElementById('toast');

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  async function init() {
    initTheme();
    updateStreak();

    if (window.TMJ_CURRICULUM && Array.isArray(window.TMJ_CURRICULUM)) {
      curriculumData = window.TMJ_CURRICULUM;
    } else {
      try {
        const res = await fetch('../data/curriculum.json');
        curriculumData = await res.json();
      } catch (err) {
        console.error('Failed to load curriculum.json:', err);
        showToast('Error loading curriculum data');
        return;
      }
    }

    renderNavigation(curriculumData);
    updateMetrics();

    // Select Chapter 3 (Portals & Anatomy) by default if available, else Chapter 1
    const defaultCh = curriculumData.find(c => c.id === 'ch03') || curriculumData[0];
    selectModule(defaultCh, defaultCh.modules[0]);

    attachEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Theme & Streak
  // ---------------------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'theme-dark';
    document.body.className = savedTheme;
  }

  function toggleTheme() {
    const newTheme = document.body.classList.contains('theme-dark') ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
  }

  function updateStreak() {
    const today = new Date().toISOString().slice(0, 10);
    let streakData = JSON.parse(localStorage.getItem(STORAGE_KEYS.STREAK) || '{"count": 1, "lastDate": ""}');

    if (streakData.lastDate) {
      const last = new Date(streakData.lastDate);
      const diffDays = Math.floor((new Date(today) - last) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        streakData.count += 1;
        streakData.lastDate = today;
      } else if (diffDays > 1) {
        streakData.count = 1;
        streakData.lastDate = today;
      }
    } else {
      streakData.lastDate = today;
    }

    localStorage.setItem(STORAGE_KEYS.STREAK, JSON.stringify(streakData));
    if (streakCountEl) streakCountEl.textContent = streakData.count;
    if (mobileStreakCountEl) mobileStreakCountEl.textContent = streakData.count;
  }

  // ---------------------------------------------------------------------------
  // Navigation & Filtering
  // ---------------------------------------------------------------------------
  function renderNavigation(chapters, query = '', partFilter = 'all') {
    curriculumNav.innerHTML = '';

    const filtered = chapters.filter(ch => {
      const matchesPart = (partFilter === 'all') || ch.part.startsWith(partFilter);
      if (!matchesPart) return false;

      if (!query) return true;
      const q = query.toLowerCase();
      const inTitle = ch.title.toLowerCase().includes(q);
      const inAuthor = ch.author.toLowerCase().includes(q);
      const inModules = ch.modules.some(m => 
        m.title.toLowerCase().includes(q) ||
        m.core_concept.toLowerCase().includes(q) ||
        m.danger_zones_pearls.toLowerCase().includes(q) ||
        m.key_terms.some(t => t.toLowerCase().includes(q))
      );
      return inTitle || inAuthor || inModules;
    });

    if (filtered.length === 0) {
      curriculumNav.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No matching modules found</div>';
      return;
    }

    filtered.forEach(ch => {
      const group = document.createElement('div');
      group.className = 'chapter-group';

      const isCompleted = ch.modules.every(m => progressState.completed.includes(m.id));
      const isActiveChapter = currentChapter && currentChapter.id === ch.id;

      const header = document.createElement('div');
      header.className = `chapter-header ${isActiveChapter ? 'active' : ''}`;
      header.innerHTML = `
        <div class="chapter-meta">
          <span class="ch-num">CH ${ch.number}</span>
          <span class="ch-title" title="${ch.title}">${ch.title}</span>
        </div>
        ${isCompleted ? '<span class="ch-status" title="Chapter Completed">✓</span>' : ''}
      `;

      const modList = document.createElement('div');
      modList.className = 'module-list';

      ch.modules.forEach(m => {
        const item = document.createElement('div');
        const isModActive = currentModule && currentModule.id === m.id;
        const isModDone = progressState.completed.includes(m.id);

        item.className = `module-item ${isModActive ? 'active' : ''}`;
        item.innerHTML = `
          <span>${m.title}</span>
          <span>${isModDone ? '✓' : '•'}</span>
        `;

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectModule(ch, m);
        });

        modList.appendChild(item);
      });

      header.addEventListener('click', () => {
        selectModule(ch, ch.modules[0]);
      });

      group.appendChild(header);
      group.appendChild(modList);
      curriculumNav.appendChild(group);
    });
  }

  // ---------------------------------------------------------------------------
  // Module Selection & Rendering
  // ---------------------------------------------------------------------------
  function selectModule(chapter, module) {
    currentChapter = chapter;
    currentModule = module;
    currentFcIndex = 0;

    // Stop ongoing speech synthesis
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      isSpeaking = false;
      listenAudioBtn.textContent = '🔊 Listen (Audio)';
    }

    // Update Breadcrumb
    activeBreadcrumb.innerHTML = `
      <span class="badge-part">${chapter.part}</span>
      <span class="sep">›</span>
      <span class="chapter-name">CH ${chapter.number}: ${chapter.title}</span>
    `;

    // Update Complete Button
    const isCompleted = progressState.completed.includes(module.id);
    updateCompleteButton(isCompleted);

    // Update active state in sidebar
    document.querySelectorAll('.chapter-header').forEach(h => h.classList.remove('active'));
    document.querySelectorAll('.module-item').forEach(m => m.classList.remove('active'));

    // Render Views
    renderLessonView(chapter, module);
    renderQuizView(chapter, module);
    renderFlashcardsView(chapter);

    // Update active tab count badge
    flashcardCountBadge.textContent = chapter.flashcards ? chapter.flashcards.length : 0;

    // On mobile, close drawer automatically and scroll smoothly to top
    if (window.innerWidth <= 900 && sidebarDrawer) {
      sidebarDrawer.classList.remove('open');
      if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function updateCompleteButton(isDone) {
    if (isDone) {
      toggleCompleteBtn.textContent = '✓ Completed';
      toggleCompleteBtn.classList.add('completed');
    } else {
      toggleCompleteBtn.textContent = 'Mark as Studied';
      toggleCompleteBtn.classList.remove('completed');
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Render Lesson View
  // ---------------------------------------------------------------------------
  function renderLessonView(chapter, module) {
    const termsHtml = module.key_terms.map(t => `<span class="term-pill">${t}</span>`).join('');

    lessonContainer.innerHTML = `
      <div class="lesson-meta-bar">
        <span class="lesson-tag">Module ${module.id} • ${chapter.part}</span>
        <span class="lesson-read-time">⏱️ ${module.read_time} surgical bite</span>
      </div>

      <h2 class="lesson-title">${module.title}</h2>
      <div class="lesson-author-source">
        <strong>Author:</strong> ${chapter.author} | <strong>Source Text:</strong> ${chapter.pdf_file} (pp. ${chapter.pages})
      </div>

      <div class="lesson-block core">
        <div class="block-header core">🎯 1. The Surgical Core (Direct Insight)</div>
        <div class="block-content">${module.core_concept}</div>
      </div>

      <div class="lesson-block technique">
        <div class="block-header technique">🛠️ 2. Surgical Technique & Nuances</div>
        <div class="block-content">${module.surgical_technique}</div>
      </div>

      <div class="lesson-block danger">
        <div class="block-header danger">⚠️ 3. Danger Zones & Clinical Pearls</div>
        <div class="block-content">${module.danger_zones_pearls}</div>
      </div>

      <div class="terms-wrapper">
        <div class="terms-label">Key Surgical Concepts & Anatomical Landmarks</div>
        <div class="terms-list">${termsHtml}</div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // 2. Render Quiz View
  // ---------------------------------------------------------------------------
  function renderQuizView(chapter, module) {
    const challenge = module.challenge;
    if (!challenge) {
      quizContainer.innerHTML = '<div class="quiz-card"><p>No challenge question for this module.</p></div>';
      return;
    }

    const savedAns = quizState.answers[module.id];
    const letters = ['A', 'B', 'C', 'D'];

    let optionsHtml = challenge.options.map((opt, i) => {
      let optClass = 'quiz-opt-btn';
      if (savedAns !== undefined) {
        if (i === challenge.correct_index) {
          optClass += ' correct';
        } else if (i === savedAns.selected) {
          optClass += ' wrong';
        }
      }

      return `
        <button class="${optClass}" data-index="${i}" ${savedAns !== undefined ? 'disabled' : ''}>
          <span class="opt-letter">${letters[i]}</span>
          <span>${opt}</span>
        </button>
      `;
    }).join('');

    let rationaleHtml = '';
    if (savedAns !== undefined) {
      const isCorrect = savedAns.selected === challenge.correct_index;
      rationaleHtml = `
        <div class="quiz-rationale">
          <div class="rationale-title">${isCorrect ? '✅ Well done, Surgeon! Correct Decision' : '❌ Operative Caution! Clinical Clarification'}</div>
          <div>${challenge.rationale}</div>
        </div>
      `;
    }

    quizContainer.innerHTML = `
      <div class="quiz-card">
        <div class="quiz-badge">🧠 1-Minute Surgical Decision Vignette</div>
        <div class="quiz-scenario">"${challenge.scenario}"</div>
        <h3 class="quiz-question">${challenge.question}</h3>
        <div class="quiz-options" id="quizOptionsList">${optionsHtml}</div>
        <div id="rationaleContainer">${rationaleHtml}</div>
      </div>
    `;

    // Attach answer selection click listeners
    const optBtns = quizContainer.querySelectorAll('.quiz-opt-btn');
    optBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedIdx = parseInt(btn.dataset.index, 10);
        handleQuizSubmit(module.id, challenge, selectedIdx);
      });
    });
  }

  function handleQuizSubmit(moduleId, challenge, selectedIdx) {
    const isCorrect = selectedIdx === challenge.correct_index;
    quizState.answers[moduleId] = {
      selected: selectedIdx,
      isCorrect: isCorrect
    };
    localStorage.setItem(STORAGE_KEYS.QUIZ, JSON.stringify(quizState));

    updateMetrics();
    renderQuizView(currentChapter, currentModule);

    if (isCorrect) {
      showToast('Correct! Great surgical recall.');
    } else {
      showToast('Incorrect. Review the clinical rationale.');
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Render Flashcards View
  // ---------------------------------------------------------------------------
  function renderFlashcardsView(chapter) {
    const cards = chapter.flashcards || [];
    if (cards.length === 0) {
      flashcardsContainer.innerHTML = '<div class="surgical-card"><p>No flashcards configured for this chapter.</p></div>';
      return;
    }

    if (currentFcIndex >= cards.length) currentFcIndex = 0;
    const card = cards[currentFcIndex];
    const isMastered = flashcardState.mastered.includes(`${chapter.id}_${currentFcIndex}`);

    flashcardsContainer.innerHTML = `
      <div class="fc-scene" id="fcScene">
        <div class="fc-card" id="fcCard">
          <!-- Front Face -->
          <div class="fc-face fc-front">
            <div class="fc-header">
              <span>Card ${currentFcIndex + 1} of ${cards.length}</span>
              <span>Category: ${card.category}</span>
            </div>
            <div class="fc-text">${card.front}</div>
            <div class="fc-hint">👆 Tap to flip • Swipe left/right for next</div>
          </div>

          <!-- Back Face -->
          <div class="fc-face fc-back">
            <div class="fc-header">
              <span>Answer / Landmark</span>
              <span>${card.category}</span>
            </div>
            <div class="fc-text">${card.back}</div>
            <div class="fc-hint">👆 Tap to flip back • Swipe for next</div>
          </div>
        </div>
      </div>

      <div class="fc-controls">
        <button class="btn btn-secondary" id="fcPrevBtn" ${currentFcIndex === 0 ? 'disabled' : ''}>← Previous</button>
        <button class="btn btn-primary" id="fcMasterBtn">${isMastered ? '✓ Mastered' : '⭐ Mark as Mastered'}</button>
        <button class="btn btn-secondary" id="fcNextBtn" ${currentFcIndex === cards.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    `;

    const fcScene = document.getElementById('fcScene');
    const fcCard = document.getElementById('fcCard');
    let touchStartX = 0;
    let touchStartY = 0;

    fcScene.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    fcScene.addEventListener('touchend', (e) => {
      const diffX = e.changedTouches[0].screenX - touchStartX;
      const diffY = e.changedTouches[0].screenY - touchStartY;
      // If horizontal swipe detected
      if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0 && currentFcIndex < cards.length - 1) {
          // Swipe Left -> Next
          currentFcIndex++;
          renderFlashcardsView(chapter);
        } else if (diffX > 0 && currentFcIndex > 0) {
          // Swipe Right -> Prev
          currentFcIndex--;
          renderFlashcardsView(chapter);
        }
      } else if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
        // Tap -> Flip
        fcCard.classList.toggle('is-flipped');
      }
    }, { passive: true });

    fcScene.addEventListener('click', (e) => {
      // For desktop pointer
      if (!('ontouchstart' in window)) {
        fcCard.classList.toggle('is-flipped');
      }
    });

    document.getElementById('fcPrevBtn').addEventListener('click', () => {
      if (currentFcIndex > 0) {
        currentFcIndex--;
        renderFlashcardsView(chapter);
      }
    });

    document.getElementById('fcNextBtn').addEventListener('click', () => {
      if (currentFcIndex < cards.length - 1) {
        currentFcIndex++;
        renderFlashcardsView(chapter);
      }
    });

    document.getElementById('fcMasterBtn').addEventListener('click', () => {
      const key = `${chapter.id}_${currentFcIndex}`;
      if (flashcardState.mastered.includes(key)) {
        flashcardState.mastered = flashcardState.mastered.filter(k => k !== key);
      } else {
        flashcardState.mastered.push(key);
      }
      localStorage.setItem(STORAGE_KEYS.FLASHCARDS, JSON.stringify(flashcardState));
      updateMetrics();
      renderFlashcardsView(chapter);
    });
  }

  // ---------------------------------------------------------------------------
  // Actions: Speech Audio, Telegram Copy, Completion
  // ---------------------------------------------------------------------------
  function toggleSpeech() {
    if (!('speechSynthesis' in window)) {
      showToast('Text-to-speech not supported on this browser');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      isSpeaking = false;
      listenAudioBtn.textContent = '🔊 Listen (Audio)';
      showToast('Audio paused');
      return;
    }

    if (!currentModule) return;

    const speechText = `${currentModule.title}. Core Surgical Concept: ${currentModule.core_concept}. Surgical Technique: ${currentModule.surgical_technique}. Danger Zones and Clinical Pearls: ${currentModule.danger_zones_pearls}`;
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      isSpeaking = true;
      listenAudioBtn.textContent = '⏹️ Stop Audio';
      showToast('Playing surgical audio digest...');
    };

    utterance.onend = () => {
      isSpeaking = false;
      listenAudioBtn.textContent = '🔊 Listen (Audio)';
    };

    utterance.onerror = () => {
      isSpeaking = false;
      listenAudioBtn.textContent = '🔊 Listen (Audio)';
    };

    window.speechSynthesis.speak(utterance);
  }

  function copyTelegramDigest() {
    if (!currentModule || !currentChapter) return;

    const telegramText = 
`📚 *TMJ ARTHROSCOPY MICRO-TUTOR*
*Chapter ${currentChapter.number}: ${currentChapter.title}*
*Module:* ${currentModule.title} (${currentModule.read_time})
*Author:* ${currentChapter.author}
_Source: ${currentChapter.pdf_file}_

🎯 *1. THE SURGICAL CORE*
${currentModule.core_concept}

🛠️ *2. SURGICAL TECHNIQUE*
${currentModule.surgical_technique}

⚠️ *3. DANGER ZONES & PEARLS*
${currentModule.danger_zones_pearls}

🧠 *DAILY RESIDENCY CHALLENGE*
Scenario: ${currentModule.challenge.scenario}
Q: ${currentModule.challenge.question}
(A) ${currentModule.challenge.options[0]}
(B) ${currentModule.challenge.options[1]}
(C) ${currentModule.challenge.options[2]}
(D) ${currentModule.challenge.options[3]}

*Rationale:* ||${currentModule.challenge.rationale}||

#TMJ #Arthroscopy #OMFS #McCainTutor`;

    navigator.clipboard.writeText(telegramText).then(() => {
      showToast('Formatted Telegram lesson copied to clipboard! 📋');
    }).catch(err => {
      console.error('Copy failed:', err);
      showToast('Failed to copy to clipboard');
    });
  }

  function toggleCompleteModule() {
    if (!currentModule) return;
    const modId = currentModule.id;
    const idx = progressState.completed.indexOf(modId);

    if (idx >= 0) {
      progressState.completed.splice(idx, 1);
      updateCompleteButton(false);
      showToast('Marked as unstudied');
    } else {
      progressState.completed.push(modId);
      updateCompleteButton(true);
      showToast('Module completed! Progress logged.');
    }

    localStorage.setItem(STORAGE_KEYS.PROGRESS, JSON.stringify(progressState));
    updateMetrics();
    renderNavigation(curriculumData, searchInput.value);
  }

  function resetAllProgress() {
    if (confirm('Are you sure you want to reset all study progress and quiz scores?')) {
      progressState = { completed: [] };
      quizState = { answers: {} };
      flashcardState = { mastered: [] };

      localStorage.removeItem(STORAGE_KEYS.PROGRESS);
      localStorage.removeItem(STORAGE_KEYS.QUIZ);
      localStorage.removeItem(STORAGE_KEYS.FLASHCARDS);

      updateMetrics();
      if (currentChapter && currentModule) {
        selectModule(currentChapter, currentModule);
      }
      renderNavigation(curriculumData);
      showToast('All progress reset.');
    }
  }

  // ---------------------------------------------------------------------------
  // Metrics & Toast
  // ---------------------------------------------------------------------------
  function updateMetrics() {
    // Total modules across all chapters
    let totalModules = 0;
    curriculumData.forEach(ch => totalModules += ch.modules.length);

    completedCountEl.textContent = `${progressState.completed.length} / ${totalModules}`;

    // Quiz Accuracy
    const ansValues = Object.values(quizState.answers);
    if (ansValues.length > 0) {
      const correctCount = ansValues.filter(a => a.isCorrect).length;
      const pct = Math.round((correctCount / ansValues.length) * 100);
      quizScorePctEl.textContent = `${pct}%`;
    } else {
      quizScorePctEl.textContent = '0%';
    }

    // Flashcards
    cardsMasteredEl.textContent = flashcardState.mastered.length;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------
  function attachEventListeners() {
    // Tabs
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const tabKey = btn.dataset.tab;
        document.getElementById(`${tabKey}TabView`).classList.add('active');
      });
    });

    // Part filter buttons
    partFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        partFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderNavigation(curriculumData, searchInput.value, btn.dataset.part);
      });
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
      const activePart = document.querySelector('.part-btn.active').dataset.part;
      renderNavigation(curriculumData, e.target.value, activePart);
    });

    // Action buttons
    if (listenAudioBtn) listenAudioBtn.addEventListener('click', toggleSpeech);
    if (copyTelegramBtn) copyTelegramBtn.addEventListener('click', copyTelegramDigest);
    if (toggleCompleteBtn) toggleCompleteBtn.addEventListener('click', toggleCompleteModule);
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
    if (resetProgressBtn) resetProgressBtn.addEventListener('click', resetAllProgress);

    // Mobile Drawer Toggle
    if (menuToggleBtn && sidebarDrawer) {
      menuToggleBtn.addEventListener('click', () => {
        sidebarDrawer.classList.add('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
      });
    }
    if (closeSidebarBtn && sidebarDrawer) {
      closeSidebarBtn.addEventListener('click', () => {
        sidebarDrawer.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
      });
    }
    if (sidebarBackdrop && sidebarDrawer) {
      sidebarBackdrop.addEventListener('click', () => {
        sidebarDrawer.classList.remove('open');
        sidebarBackdrop.classList.add('hidden');
      });
    }
  }

  // Start app
  window.addEventListener('DOMContentLoaded', init);
})();
