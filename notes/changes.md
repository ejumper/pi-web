# Explorer
## Make Explorerer Slightly Bigger
I want to make the expleror line slightly bigger so the buttons are easier to press (~25%)

## Change "Explorer" to "Files" 
change Explorer to read Files (just leaves more room for buttons)

## add a "go to path" button
A new button to the left of the "up one directory" that lets you type in a path to change directory
- effectively the equivalent of `cd`
- just like the "up one directory" button this works independently of the session's cwd, and changing the session's cwd will also still move the explorer there.
- search bar should appear on a row above the dir list, just like when I hit new file or new folder
- enter sends, if the path doesn't exist, it is rejected, the path flashes red and remains in the search bar until a valid path is entered, esc closes it with no changes, or focus leaves the search bar (also closes the search bar)
- if a file path is typed, and the file exists (and can be opened in codemirror), the explorer cwd shouldn't change, the file should simply be opened in codemirror.
- uses the magnifine glass icon for the button

## add a "return to session dir" button
Add a button (home icon) that returns the explorer cwd to the sessions cwd if "go to path" or "up one dir" have moved it out of there.

# Top Bar
## Rearrange top Bar buttons
I want to rework the top bar above the prompt editor / session transcript area. This will involve moving, removing and adding buttons.
- Right now it goes from left to right...
  - left panel toggle
  - light/dark theme toggle
  - "full history" button
  - branches
  - system prompt
  - voicemail notify
  - session info
  - right pannel toggle
- I want it to look like...
  - left panel toggle
  - "full history" button
  - branches
  - notepad (file with writing on it icon)
    - this opens a dropdown with two options...
      - tmpnote
        - opens "/tmp/notepad.md" in the editor
      - quicknote
        - opens Jumperpedia/Quicknotes/notepad.md in the editor
          - should work on desktop (~/Halfacloud/Jumperpedia) or server (~/Jumperpedia)
      - both of these are for when I want to quickly write down ephemoral notes without polluting my project directory. I was thinking it should probably be a variable rather than hardcoded to make swapping them easy.
  - new (+ icon)
    - opens a new session in the same cwd
  - voicemail notify
  - session info
  - right panel toggle

The system prompt button is gone. I have no reason to change that ever. The light/dark theme toggle should be moved to the left panel to the right of the refresh button. To make room for it the "Pi Agent Web" banner will be replaced with simply "π", bolded and slightly larger than the current font size, so ip more closely matches the button hights. While you're at it, remove "π Pi Agent Web" from above the prompt editor in empty sessions. Its pointless, I know what webpage I'm on.

# fix overflow when mobile keyboard appears
- right now when I open a new session the prompt editor is pinned right in the middle of the screen, but on mobile (not an issue on desktop), as soon as I select the prompt editor I get scrolling. It seems like the issue is the editor box wants to sit in the center of the page, and when the mobile keyboard pops up it messes it up. Is there a way to make it so that the button row below the prompt editor is reliably pinned to just above the top of the mobile keyboard?

# Code Mirror tweaks 

## close right panel with a swipe on mobile
same way I can open it by swiping from the right edge to the left I want to be able to toggle it closed by swiping from left to right

## Alter codemirror markdown syntax highlighting
I want to make the markdown syntax highlighting match micro_indent's exactly. same h1 full line across the page, same green code wraps, gray "*", etc. 

## codemirror character/word count
replacing the line numbers, I'd like to have character and word number listed in the top bar. 
- to help make room for this, I thought a few things could be compressed
  - "Save" button could show the floppy disc icon instead
  - "wrap" buttom could show left justified lines icon
  - "edit" could show a wrench icon
  - the green circle with "live" next to it, could just be the green circle instead, no "live" text

## I'd like to discuss getting spellcheck
not worth a lot of effort right now, but I thought because I think browsers have spellcheck built in, maybe there's a way to have it applied to the text in codemirror? if I'd have to implement it myself though, I don't want it right now.

# future fixes (out of today's scope)
the live extension is buggy.
- it labels any recently used session as live, regardless of whether it has a corresponding TUI session
- when I reopen the app while a run issgoing, I often haveeto re-open the session to see the latest changes.