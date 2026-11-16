# Press Conference

A spoken improv game for 4–12 players, staged as a local news broadcast outside city hall.

Includes 600 handwritten silly premises, shuffled without repeats within each game.

## Playing

1. Start **Press Conference** from the game picker and join on your phones. The TV or first available player in the shuffled order can tap **Go live**. A short broadcast fanfare opens the show; there is no background music during speech.
2. Each player gets one briefing as the presenter. Everyone else sees the silly premise on their own phone. The TV and presenter phone keep it hidden.
3. The presenter taps **Take the podium**. The named reporter asks a question aloud; the presenter confidently improvises an answer. After the answer, that reporter taps **Answer finished · next reporter**.
4. Reporters cycle repeatedly. There is no question deadline or countdown: quick answers simply let the room hear more questions. Hint through questions without saying the secret outright.
5. The presenter can tap **I have a guess** anytime, then say both who they are and what they did. The current reporter confirms **Yes! They got it** or **Not quite · keep going**. Wording does not have to be exact.
6. A correct guess reveals the premise and ends the briefing. The presenter can also choose **Reveal & end my briefing**. Continue to the next presenter, then finish with a recap of questions and elapsed time. There are no points.

The TV has equivalent controls for helping the room along. Phone reconnects restore the current role and screen. Disconnected reporters are skipped; an absent presenter pauses the briefing, with a TV control to end it. Players still absent when their next briefing comes up are skipped. New players join the next game.

## Checks

Run `node --test tools/test-press-conference.mjs` from the repository root for rules, hidden information, turn permissions, disconnects, and all player counts.

With Party Hall running and Playwright installed, run `node tools/test-press-conference-browser.cjs http://localhost:8080` for complete four- and twelve-player browser games, reconnects, phone secrecy, visual audits, and lobby cleanup. Screenshots are written to `/tmp/press-conference-qa` by default. Set `BROWSER_EXECUTABLE` if using an existing Chromium installation and `OUT` to change the screenshot directory.
