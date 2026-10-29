// The words. Every line of poetry in the film, with its timing, and nothing else: no shaders, no camera. Edit freely.
// Times are in seconds, local to the act (an act's local clock starts when the act does; see film.js for how acts overlap).
// A cue is { id, kind: "title" | "poem", text | lines, place: "low" | "mid" | "high", variant?: "quiet",
//            in: [start, fully visible], out?: [start of dissolve, gone] }
// At most three lines are ever on screen together, and most of the time one or two; long silences are part of the poem.
(function (root) {
  "use strict";

  // Act I's first verse is the film's original opening verse and must stay exactly as it was written.
  const OPENING_VERSE = ["A hundred winters I have kept your name,", "and the moon alone still keeps the count."];

  const script = {
    OPENING_VERSE,

    // I. The waiting: loneliness
    act1: [
      { id: "a1.title", kind: "title", text: "ETERNAL", place: "mid", in: [7.6, 10.6], out: [15.4, 17.0] },
      { id: "a1.verse", kind: "poem", lines: OPENING_VERSE, place: "low", in: [10.2, 12.0], out: [13.6, 14.7] },
      { id: "a1.towers", kind: "poem", lines: ["The towers forgot their builders.", "I have not forgotten you."], place: "low", in: [18.2, 20.4], out: [22.6, 23.8] },
    ],

    // II. The memory: a voice remembered, a name that survives in silence, memory and dream grown indistinguishable
    act2: [
      { id: "a2.voice", kind: "poem", lines: ["Your voice is the last room", "I have not let fall to ruin."], place: "low", in: [3.0, 5.2], out: [9.4, 10.8] },
      { id: "a2.name", kind: "poem", lines: ["Your name survives in the silence,", "the way a bell outlives its sound."], place: "low", in: [12.8, 15.0], out: [19.8, 21.2] },
      { id: "a2.dream", kind: "poem", lines: ["Some nights I cannot tell my memories", "from the dreams that learned your face."], place: "low", in: [23.2, 25.6], out: [28.6, 29.9] },
    ],

    // III. The lost beloved: a vanished hand, a fading face, love where presence cannot be
    act3: [
      { id: "a3.hand", kind: "poem", lines: ["My hand still keeps the shape of yours.", "It closes on the cold air all the same."], place: "low", in: [3.0, 5.4], out: [9.6, 11.0] },
      { id: "a3.face", kind: "poem", lines: ["I have lost the colour of your eyes.", "I have not lost the way you turned."], place: "low", in: [13.4, 15.8], out: [20.0, 21.4] },
      { id: "a3.light", kind: "poem", lines: ["Love needs no body to stand here.", "It leaves a light where no one is."], place: "low", in: [23.6, 26.0], out: [28.6, 29.9] },
    ],

    // IV. The oath: forceful, and the cost of it. Times are local to act IV; act V takes over the same sky at 32 s.
    act4: [
      { id: "a4.centuries", kind: "poem", lines: ["Let the centuries come.", "Let them break on these walls like weather."], place: "low", in: [3.4, 5.8], out: [10.2, 11.4] },
      { id: "a4.winter", kind: "poem", lines: ["I will wait through every winter.", "I will outlast the dark itself."], place: "low", in: [14.0, 16.4], out: [20.4, 21.6] },
      { id: "a4.price", kind: "poem", lines: ["This is the price of never ending:", "to stay when everything leaves."], place: "low", in: [23.2, 26.0], out: [29.0, 30.2] },
      { id: "a4.gladly", kind: "poem", lines: ["I pay it gladly."], place: "low", in: [31.4, 33.2], out: [34.4, 35.6] },
    ],

    // V. Until eternity: quiet, no happy ending, only a wait that has become the love
    act5: [
      { id: "a5.storm", kind: "poem", lines: ["The storm forgets itself.", "The moon does not."], place: "low", in: [9.4, 12.0], out: [15.4, 16.8] },
      { id: "a5.stay", kind: "poem", lines: ["I do not know if you will come.", "I know that I will stay."], place: "low", in: [19.0, 22.0], out: [26.4, 27.8] },
      { id: "a5.shape", kind: "poem", lines: ["The waiting has become", "the shape of you."], place: "low", in: [28.6, 31.4], out: [33.2, 34.4] },
      { id: "a5.title", kind: "title", text: "ETERNAL", place: "mid", variant: "quiet", in: [33.4, 35.6] },
    ],
  };

  if (typeof module === "object" && module.exports) module.exports = script;
  else (root.ETERNAL = root.ETERNAL || {}).script = script;
})(typeof self !== "undefined" ? self : globalThis);
