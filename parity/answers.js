// The questions `agreement.js` puts to both models.
//
// Chosen to be answerable and unambiguous — a case where Jev itself is unsure
// measures the case, not the gap — and spread across the things these models
// are asked to do in practice: plain fact, negation, what a pronoun refers to,
// information that is absent, a judgment about a quantity, and reading code.
//
// Each case has exactly one question. Two questions in one request share a
// premise, and a disagreement would then be hard to attribute.

export const AGREEMENT_CASES = [
  // --- nouls -----------------------------------------------------------------
  {
    kind: "noul",
    name: "a plain fact",
    state: { note: "We drove the new route and the trip took about an hour." },
    questions: { q: { type: "noul", instructions: "The writer travelled by car." } },
  },
  {
    kind: "noul",
    name: "negation",
    state: { note: "The package never arrived." },
    questions: { q: { type: "noul", instructions: "The package arrived." } },
  },
  {
    kind: "noul",
    name: "what 'it' refers to",
    state: { note: "I fed the dog before the meeting. It ran long." },
    questions: { q: { type: "noul", instructions: "The meeting lasted longer than planned." } },
  },
  {
    kind: "noul",
    name: "the state does not say",
    state: { note: "We drove the new route and the trip took about an hour." },
    questions: { q: { type: "noul", instructions: "The writer was late for work." } },
  },
  {
    kind: "noul",
    name: "a quantity, true",
    state: { note: "The trip normally takes an hour. Today it was about forty minutes longer." },
    questions: { q: { type: "noul", instructions: "The trip took more than half an hour longer than usual." } },
  },
  {
    kind: "noul",
    name: "the same quantity, false",
    state: { note: "The trip normally takes an hour. Today it was about five minutes longer." },
    questions: { q: { type: "noul", instructions: "The trip took more than half an hour longer than usual." } },
  },
  {
    kind: "noul",
    name: "code: an error is swallowed",
    state: { code: "try { return risky(); } catch (e) {}" },
    questions: { q: { type: "noul", instructions: "This code catches an error and carries on without saying so." } },
  },
  {
    kind: "noul",
    name: "code: an error is not swallowed",
    state: { code: "try { return risky(); } catch (e) { logger.error(e); throw e; }" },
    questions: { q: { type: "noul", instructions: "This code catches an error and carries on without saying so." } },
  },
  {
    kind: "noul",
    name: "code: the name fits",
    state: { code: "function total(items) { return items.reduce((a, b) => a + b.price, 0); }" },
    questions: { q: { type: "noul", instructions: "The function does what its name says." } },
  },
  {
    kind: "noul",
    name: "code: the name does not fit",
    state: { code: "function total(items) { return items.length; }" },
    questions: { q: { type: "noul", instructions: "The function returns the sum of the item prices." } },
  },
  {
    kind: "noul",
    name: "sentiment",
    state: { review: "The room was filthy and the staff were rude." },
    questions: { q: { type: "noul", instructions: "The reviewer was satisfied." } },
  },
  {
    kind: "noul",
    name: "a condition that did not hold",
    state: { note: "If it rains we will cancel. The forecast is clear." },
    questions: { q: { type: "noul", instructions: "The event is going ahead." } },
  },

  // --- choices ---------------------------------------------------------------
  {
    kind: "choice",
    name: "the cause given in the text",
    state: { note: "We left at nine and arrived at ten thirty, about forty minutes longer than usual because of roadworks." },
    questions: {
      q: {
        type: "choice",
        instructions: "What made the trip longer?",
        criteria: { roadworks: "Roadworks on the route.", weather: "Bad weather.", "late start": "They set off late." },
      },
    },
  },
  {
    kind: "choice",
    name: "routing a support ticket",
    state: { ticket: "My card was charged twice for the same order." },
    questions: {
      q: {
        type: "choice",
        instructions: "Which team should handle this ticket?",
        criteria: { billing: "Payments and invoices.", shipping: "Delivery problems.", technical: "The app or website is broken." },
      },
    },
  },
  {
    kind: "choice",
    name: "which language",
    state: { text: "Der Zug faehrt in fuenf Minuten ab." },
    questions: {
      q: { type: "choice", instructions: "What language is the text written in?", criteria: { german: "German.", dutch: "Dutch.", swedish: "Swedish." } },
    },
  },
  {
    kind: "choice",
    name: "what the sender wants",
    state: { message: "Can you tell me when my order ships?" },
    questions: {
      q: {
        type: "choice",
        instructions: "What does the sender want?",
        criteria: { status: "An update on an existing order.", refund: "Money back.", complaint: "To complain about service." },
      },
    },
  },
  {
    kind: "choice",
    name: "none of the options fits",
    state: { note: "The cat sat on the mat." },
    questions: {
      q: {
        type: "choice",
        instructions: "What is the writer complaining about?",
        criteria: { price: "The cost.", quality: "How well it was made.", nothing: "The writer is not complaining." },
      },
    },
  },
  {
    kind: "choice",
    name: "code: which problem this is",
    state: { code: "const x: any = JSON.parse(s);" },
    questions: {
      q: {
        type: "choice",
        instructions: "Which problem best describes this line?",
        criteria: { any: "The type system was bypassed.", secret: "A credential was hard-coded.", dead: "The code is unreachable." },
      },
    },
  },

  // --- scores ----------------------------------------------------------------
  {
    kind: "score",
    name: "severity, high end",
    state: { change: "The login page was changed so that any password is accepted for the admin account." },
    questions: {
      q: {
        type: "score",
        instructions: "How serious is this for security?",
        criteria: ["Harmless.", "Worth a comment.", "Should be fixed.", "Must be fixed before this ships."],
      },
    },
  },
  {
    kind: "score",
    name: "severity, low end",
    state: { change: "A greeting shown on the home page was reworded." },
    questions: {
      q: {
        type: "score",
        instructions: "How serious is this for security?",
        criteria: ["Harmless.", "Worth a comment.", "Should be fixed.", "Must be fixed before this ships."],
      },
    },
  },
  {
    kind: "score",
    name: "urgency, high end",
    state: { ticket: "The whole site is down and no customer can check out." },
    questions: {
      q: { type: "score", instructions: "How urgent is this?", criteria: ["Can wait a month.", "Can wait a week.", "Today.", "Right now."] },
    },
  },
  {
    kind: "score",
    name: "urgency, low end",
    state: { ticket: "It would be nice if the logo were slightly bigger." },
    questions: {
      q: { type: "score", instructions: "How urgent is this?", criteria: ["Can wait a month.", "Can wait a week.", "Today.", "Right now."] },
    },
  },
  {
    kind: "score",
    name: "reading difficulty",
    state: { text: "The cat sat on the mat. It was warm." },
    questions: {
      q: {
        type: "score",
        instructions: "How hard is this to read?",
        criteria: ["A young child could read it.", "A teenager could read it.", "An adult reader.", "A specialist."],
      },
    },
  },
  {
    kind: "score",
    name: "how well a claim is supported",
    state: { note: "Some people say the bridge might be closed, but nobody has checked." },
    questions: {
      q: {
        type: "score",
        instructions: "How well supported is the claim that the bridge is closed?",
        criteria: ["Not at all.", "Weakly.", "Reasonably.", "Very well."],
      },
    },
  },
];
