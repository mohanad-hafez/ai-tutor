import { useGraphStore } from '../store/graphStore';
import type { FrameContent, FrameData } from '../types';
import {
  LINEAR_REGRESSION_DEMO,
  LOOK_AT_DATA_DEMO,
  RESIDUALS_DEMO,
  makeTopicCardContent,
} from './demoLessons';

// A curated multi-branch knowledge graph that simulates what a learner
// might explore from a single Linear Regression document. Three of the
// nodes (LR, Look-at-data, Residuals) load full interactive walkthroughs;
// the rest render polished topic cards. Use seedDemoGraph() to wipe the
// canvas and load this graph.

interface SeedNode {
  id: string;
  title: string;
  summary: string;
  parent?: string;
  // Either pull content from one of the registered canned demos
  // ('lr' | 'lad' | 'res') or render a placeholder topic card.
  content: 'lr' | 'lad' | 'res' | { blurb: string; parentTopic: string };
}

const SEEDS: SeedNode[] = [
  // ─────────────── Root ───────────────
  {
    id: 's-lr',
    title: 'Linear Regression',
    summary: 'Drawing the straight line that best matches a cloud of points.',
    content: 'lr',
  },

  // ─────────────── Branch 1 — reading the data ───────────────
  {
    id: 's-lad',
    title: 'Look at the data',
    summary: 'Reading a scatter plot before any modeling.',
    parent: 's-lr',
    content: 'lad',
  },
  {
    id: 's-obs',
    title: 'Observations',
    summary: 'Each row of the dataset is one (x, y) pair.',
    parent: 's-lad',
    content: {
      parentTopic: 'Look at the data',
      blurb: 'An <b>observation</b> is a single row of your dataset — a pair of numbers (x, y) you have measured. One observation is just a dot on a plot; many observations together start to show <em>shape</em>.',
    },
  },
  {
    id: 's-trend',
    title: 'Trend',
    summary: 'The general direction of the cloud of points.',
    parent: 's-lad',
    content: {
      parentTopic: 'Look at the data',
      blurb: 'The <b>trend</b> is the overall direction of a scatter plot — does y rise with x, fall with x, or scatter without direction? Spotting the trend is the first sanity check before fitting a line.',
    },
  },
  {
    id: 's-out',
    title: 'Outliers',
    summary: 'Points that strain a clean trend.',
    parent: 's-lad',
    content: {
      parentTopic: 'Look at the data',
      blurb: '<b>Outliers</b> are observations that sit far from the trend the rest of the data suggests. They can <em>pull a fitted line in unexpected directions</em>, so it pays to spot them before fitting.',
    },
  },

  // ─────────────── Branch 2 — equation of a line ───────────────
  {
    id: 's-eq',
    title: 'y = m·x + b',
    summary: 'Two numbers fully describe any straight line.',
    parent: 's-lr',
    content: {
      parentTopic: 'Linear Regression',
      blurb: 'Every straight line is described by exactly two numbers: the <b>slope m</b> (steepness) and the <b>intercept b</b> (where it crosses the y-axis). Together they pin down a unique line — finding the right (m, b) is what regression actually does.',
    },
  },
  {
    id: 's-slope',
    title: 'Slope (m)',
    summary: 'Rise over run — how steep the line is.',
    parent: 's-eq',
    content: {
      parentTopic: 'y = m·x + b',
      blurb: '<b>Slope</b> is rise over run: for every step you take in x, how much does y go up or down? Bigger |m| means a steeper line; m = 0 is flat; m &lt; 0 slopes down.',
    },
  },
  {
    id: 's-int',
    title: 'Intercept (b)',
    summary: 'Where the line crosses x = 0.',
    parent: 's-eq',
    content: {
      parentTopic: 'y = m·x + b',
      blurb: 'The <b>intercept</b> is the value of y when x is zero — literally where the line crosses the y-axis. Shifting b moves the entire line up or down without changing its tilt.',
    },
  },

  // ─────────────── Branch 3 — residuals → SSE ───────────────
  {
    id: 's-res',
    title: 'Residuals',
    summary: 'The gap between each point and the line.',
    parent: 's-lr',
    content: 'res',
  },
  {
    id: 's-yhat',
    title: 'Predicted ŷ',
    summary: 'What your line says y should be.',
    parent: 's-res',
    content: {
      parentTopic: 'Residuals',
      blurb: '<b>ŷ</b> (&ldquo;y-hat&rdquo;) is the value the line predicts for a given x — just plug x into y = m·x + b. The actual y minus ŷ is the <em>residual</em>: how wrong your prediction was for that one point.',
    },
  },
  {
    id: 's-sqerr',
    title: 'Squared errors',
    summary: 'Squaring residuals so signs do not cancel.',
    parent: 's-res',
    content: {
      parentTopic: 'Residuals',
      blurb: 'If you summed raw residuals, positives and negatives would partially cancel. Squaring makes every error positive <b>and</b> punishes big misses much harder than small ones — a residual of 2 squares to 4, but 4 squares to 16.',
    },
  },
  {
    id: 's-sse',
    title: 'Sum of Squared Errors',
    summary: 'One number that summarizes total error.',
    parent: 's-lr',
    content: {
      parentTopic: 'Linear Regression',
      blurb: 'Add the squared residuals across every observation. That is <b>SSE</b>: one number saying &ldquo;how wrong is this line, overall.&rdquo; The smaller, the better — and finding the line with the smallest SSE is exactly what regression does.',
    },
  },

  // ─────────────── Branch 4 — solving for the best line ───────────────
  {
    id: 's-ls',
    title: 'Least squares',
    summary: 'The line with the smallest SSE.',
    parent: 's-lr',
    content: {
      parentTopic: 'Linear Regression',
      blurb: 'Out of every possible line, <b>least squares</b> picks the (m, b) that minimizes the sum of squared errors. It does not have to guess — there is a clean closed-form formula derived from setting the partial derivatives of SSE to zero.',
    },
  },
  {
    id: 's-norm',
    title: 'Normal equations',
    summary: 'The closed-form least-squares solution.',
    parent: 's-ls',
    content: {
      parentTopic: 'Least squares',
      blurb: 'Set ∂SSE/∂m and ∂SSE/∂b to zero. Solving the resulting linear system gives the <b>normal equations</b> — the exact (m, b) that minimize SSE, with no iteration needed.',
    },
  },
  {
    id: 's-gd',
    title: 'Gradient descent',
    summary: 'Iterative alternative to the closed form.',
    parent: 's-lr',
    content: {
      parentTopic: 'Linear Regression',
      blurb: 'When the closed-form solution is too expensive (millions of features, billions of rows), <b>gradient descent</b> walks downhill on the loss surface step by step. The same idea generalizes from linear models all the way to neural networks.',
    },
  },
  {
    id: 's-lr-rate',
    title: 'Learning rate',
    summary: 'Step size of each descent update.',
    parent: 's-gd',
    content: {
      parentTopic: 'Gradient descent',
      blurb: 'Too small and you crawl toward the answer. Too big and you overshoot and never converge. The <b>learning rate</b> is the most important hyperparameter to tune — picking it right separates training that works from training that diverges.',
    },
  },
  {
    id: 's-loss',
    title: 'Loss surface',
    summary: 'The shape of SSE as a function of (m, b).',
    parent: 's-gd',
    content: {
      parentTopic: 'Gradient descent',
      blurb: 'Plot SSE against m and b in 3D and you get a <b>loss surface</b>. For linear regression it is a smooth bowl with one minimum — gradient descent rolls toward the bottom.',
    },
  },

  // ─────────────── Branch 5 — going further ───────────────
  {
    id: 's-beyond',
    title: 'Beyond simple regression',
    summary: 'Where the basic model breaks and what to do.',
    parent: 's-lr',
    content: {
      parentTopic: 'Linear Regression',
      blurb: 'One x is rarely enough. Real models use <b>many features</b> at once, fit <b>curves</b>, and apply tools to keep them honest. Three branches lead away from simple linear regression: more features, non-linear shapes, and fighting overfitting.',
    },
  },
  {
    id: 's-multi',
    title: 'Multiple regression',
    summary: 'Many features predicting one target.',
    parent: 's-beyond',
    content: {
      parentTopic: 'Beyond simple regression',
      blurb: 'Instead of one x, use a vector of features: y = β₀ + β₁x₁ + β₂x₂ + … + βₚxₚ. The math is the same idea (squared error, closed form), but written in matrix form: <b>β = (XᵀX)⁻¹Xᵀy</b>.',
    },
  },
  {
    id: 's-poly',
    title: 'Polynomial regression',
    summary: 'Fitting curves with linear methods.',
    parent: 's-beyond',
    content: {
      parentTopic: 'Beyond simple regression',
      blurb: 'Linear regression fits straight lines — but you can fit a curve by adding x², x³, … as new features. The model stays linear in the parameters; the <em>curve is in the features</em>, not the model.',
    },
  },
  {
    id: 's-over',
    title: 'Overfitting',
    summary: 'When a flexible model memorizes noise.',
    parent: 's-beyond',
    content: {
      parentTopic: 'Beyond simple regression',
      blurb: 'A flexible model can hit every training point exactly — and generalize horribly to new data. Splitting train/test and watching for divergence between training error and test error is how you catch <b>overfitting</b>.',
    },
  },
  {
    id: 's-reg',
    title: 'Regularization',
    summary: 'Penalize big coefficients to fight overfitting.',
    parent: 's-beyond',
    content: {
      parentTopic: 'Beyond simple regression',
      blurb: 'Add a penalty on the size of the coefficients to your loss: <b>Ridge</b> penalizes ‖β‖², <b>Lasso</b> penalizes ‖β‖₁. Smaller coefficients = simpler model = less overfitting.',
    },
  },
];

function resolveContent(seed: SeedNode): FrameContent {
  if (seed.content === 'lr') return LINEAR_REGRESSION_DEMO.content;
  if (seed.content === 'lad') return LOOK_AT_DATA_DEMO.content;
  if (seed.content === 'res') return RESIDUALS_DEMO.content;
  return makeTopicCardContent(seed.title, seed.content.blurb, seed.content.parentTopic);
}

// Replace the current canvas with a curated multi-branch demo graph.
// Adds nodes parent-first so addFrame() can wire each child edge as it
// goes; the caller is expected to run auto-layout afterwards to space
// them properly.
export function seedDemoGraph(): void {
  const { reset, addFrame, setFocused } = useGraphStore.getState();
  reset();

  for (const seed of SEEDS) {
    const data: FrameData = {
      id: seed.id,
      type: seed.parent ? 'child' : 'root',
      title: seed.title,
      summary: seed.summary,
      sourceText: seed.title,
      parentIds: seed.parent ? [seed.parent] : [],
      childIds: [],
      loading: false,
      mode: 'visual_html',
      content: resolveContent(seed),
    };
    addFrame(data, seed.parent);
  }

  setFocused('s-lr');
}
