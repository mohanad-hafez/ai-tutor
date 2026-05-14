"""
Linear regression — explained from zero, the way the AI Tutor app pitches it.

Pedagogical arc (no prior stats knowledge assumed):
    1. Frame the problem: data with a pattern.
    2. Hypothesize a straight-line relationship: y = m·x + b.
    3. Show residuals — vertical errors from each point to the candidate line.
    4. Square them — total squared area = "how wrong" the line is.
    5. Animate m, b sliding toward the least-squares solution; squares shrink.
    6. Use the line for a new prediction.

Renders with manim CE 0.20+. Uses Text only (no LaTeX dependency).
"""

from manim import (
    Scene, VGroup, Axes, Text, Dot, DashedLine, Polygon, Rectangle, Create,
    FadeIn, FadeOut, Write, ReplacementTransform, LaggedStart, ValueTracker,
    always_redraw, smooth, BOLD, UP, DOWN, LEFT, RIGHT, PI,
)
import numpy as np


# Project palette
BG       = "#0a0a0d"
TEXT     = "#e5e5e5"
DIM      = "#a3a3a8"
INDIGO   = "#818cf8"
INDIGO_2 = "#6366f1"
ROSE     = "#f87171"
ROSE_2   = "#fca5a5"
CYAN     = "#22d3ee"
CYAN_2   = "#67e8f9"
AXIS     = "#525258"


def caption(text, color=DIM, size=24):
    """A bottom caption that doesn't overlap the chart."""
    t = Text(text, color=color, font_size=size)
    t.to_edge(DOWN, buff=0.35)
    return t


class Lesson(Scene):
    def construct(self):
        self.camera.background_color = BG

        # ─── Beat 1 — title + the question ────────────────────────────────────
        title = Text("Linear Regression", color=TEXT, weight=BOLD).scale(0.95).to_edge(UP, buff=0.45)
        sub = Text(
            "How do we draw a line that 'fits' a cloud of points?",
            color=INDIGO, font_size=24,
        ).next_to(title, DOWN, buff=0.22)

        self.play(Write(title), run_time=1.2)
        self.play(FadeIn(sub, shift=UP * 0.15), run_time=0.8)
        self.wait(0.5)

        # ─── Beat 2 — set up axes (size vs price) ─────────────────────────────
        ax = Axes(
            x_range=[0, 11, 2],
            y_range=[0, 11, 2],
            x_length=9,
            y_length=4.6,
            axis_config={"color": AXIS, "include_numbers": False, "stroke_width": 2},
            tips=False,
        ).shift(DOWN * 0.7)

        x_lbl = Text("Size", color=DIM, font_size=22)
        x_lbl.next_to(ax.x_axis.get_end(), DOWN, buff=0.18)
        y_lbl = Text("Price", color=DIM, font_size=22)
        y_lbl.next_to(ax.y_axis.get_end(), LEFT, buff=0.20)

        self.play(FadeOut(sub), run_time=0.4)
        self.play(Create(ax), FadeIn(x_lbl), FadeIn(y_lbl), run_time=1.2)

        # ─── Beat 3 — drop the data ───────────────────────────────────────────
        # Hand-tuned: noticeable upward trend + visible noise (so residuals matter).
        xs = np.array([1.5, 2.4, 3.3, 4.2, 5.1, 6.0, 6.9, 7.8, 8.7, 9.6])
        ys = np.array([1.6, 2.0, 3.6, 3.4, 5.2, 4.7, 6.4, 7.6, 7.2, 8.8])

        dots = VGroup(*[
            Dot(ax.c2p(x, y), color=TEXT, radius=0.07).set_z_index(4)
            for x, y in zip(xs, ys)
        ])
        cap1 = caption("Each dot is one observation we've collected.", DIM, 22)
        self.play(
            LaggedStart(*[FadeIn(d, scale=0.5) for d in dots], lag_ratio=0.10),
            run_time=1.6,
        )
        self.play(FadeIn(cap1, shift=UP * 0.1), run_time=0.5)
        self.wait(0.6)

        # ─── Beat 4 — guess a line ────────────────────────────────────────────
        # Start far from optimal so the search animation is dramatic.
        m = ValueTracker(0.25)
        b = ValueTracker(2.6)

        line = always_redraw(lambda: ax.plot(
            lambda x: m.get_value() * x + b.get_value(),
            x_range=[0.3, 10.5],
            color=INDIGO_2,
            stroke_width=4,
        ))

        eq_label = always_redraw(lambda: Text(
            f"y = {m.get_value():.2f}·x + {b.get_value():.2f}",
            color=INDIGO, font_size=22,
        ).move_to(ax.c2p(2.0, 10.2)))

        cap2 = caption("Hypothesis: a straight line   y = m·x + b", INDIGO, 24)
        self.play(ReplacementTransform(cap1, cap2), run_time=0.6)
        self.play(Create(line), FadeIn(eq_label), run_time=1.2)
        self.wait(0.4)

        # ─── Beat 5 — residuals (vertical errors) ─────────────────────────────
        def make_residual(i):
            return always_redraw(lambda i=i: DashedLine(
                ax.c2p(xs[i], ys[i]),
                ax.c2p(xs[i], m.get_value() * xs[i] + b.get_value()),
                color=ROSE, stroke_width=2.5, dash_length=0.08,
            ))
        residuals = VGroup(*[make_residual(i) for i in range(len(xs))])

        cap3 = caption("Residual = how wrong the line is at each point.", ROSE_2, 22)
        self.play(ReplacementTransform(cap2, cap3), run_time=0.6)
        self.play(
            LaggedStart(*[Create(r) for r in residuals], lag_ratio=0.06),
            run_time=1.4,
        )
        self.wait(0.6)

        # ─── Beat 6 — square the residuals ────────────────────────────────────
        # Because some points are on the right edge, draw their squares to the
        # left so they stay inside the chart.
        def make_square(i):
            def build(i=i):
                pred = m.get_value() * xs[i] + b.get_value()
                obs = ys[i]
                h = obs - pred  # signed in data units
                if abs(h) < 1e-3:
                    return Rectangle(width=0.001, height=0.001,
                                     stroke_opacity=0, fill_opacity=0)
                # Squares > 1 wide near the right edge would clip; flip them.
                sign = -1 if xs[i] > 7.5 else 1
                x0 = xs[i]
                x1 = xs[i] + sign * abs(h)
                y0 = pred
                y1 = obs
                corners = [
                    ax.c2p(x0, y0), ax.c2p(x1, y0),
                    ax.c2p(x1, y1), ax.c2p(x0, y1),
                ]
                return Polygon(
                    *corners,
                    color=ROSE,
                    stroke_width=1.6,
                    fill_color=ROSE,
                    fill_opacity=0.20,
                )
            return always_redraw(build)
        squares = VGroup(*[make_square(i) for i in range(len(xs))])

        cap4 = caption("Square each error.   Total area = 'badness' of the line.", ROSE_2, 22)
        self.play(ReplacementTransform(cap3, cap4), run_time=0.6)
        self.play(*[FadeIn(s) for s in squares], run_time=1.0)
        self.wait(0.7)

        # ─── Beat 7 — animate the search toward least squares ─────────────────
        cap5 = caption("Slide m and b to shrink every square at once…", INDIGO, 24)
        self.play(ReplacementTransform(cap4, cap5), run_time=0.6)

        m_hat, b_hat = np.polyfit(xs, ys, 1)
        self.play(
            m.animate.set_value(float(m_hat)),
            b.animate.set_value(float(b_hat)),
            run_time=3.2,
            rate_func=smooth,
        )
        self.wait(0.5)

        # ─── Beat 8 — payoff: the best fit + a prediction ─────────────────────
        cap6 = caption(
            f"Best fit:   y = {m_hat:.2f}·x + {b_hat:.2f}",
            INDIGO, 26,
        )
        self.play(ReplacementTransform(cap5, cap6), run_time=0.6)

        # Fade the squares + residual dashes so the line stands clean.
        self.play(
            *[s.animate.set_opacity(0.0) for s in squares],
            *[r.animate.set_stroke(opacity=0.0) for r in residuals],
            run_time=0.8,
        )

        # Predict for a new x value not in the training set.
        new_x = 5.6
        new_y = float(m_hat * new_x + b_hat)
        guide_v = DashedLine(
            ax.c2p(new_x, 0), ax.c2p(new_x, new_y),
            color=CYAN, dash_length=0.07, stroke_width=2.4,
        )
        guide_h = DashedLine(
            ax.c2p(0, new_y), ax.c2p(new_x, new_y),
            color=CYAN, dash_length=0.07, stroke_width=2.4,
        )
        new_pt = Dot(ax.c2p(new_x, new_y), color=CYAN, radius=0.10).set_z_index(5)

        cap7 = caption("New input?  Look up the line — that's the prediction.", CYAN_2, 22)
        self.play(ReplacementTransform(cap6, cap7), run_time=0.6)
        self.play(Create(guide_v), run_time=0.7)
        self.play(Create(guide_h), run_time=0.7)
        self.play(FadeIn(new_pt, scale=0.4), run_time=0.5)
        self.wait(1.2)
