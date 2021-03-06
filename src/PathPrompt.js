import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import readline from 'readline';
import runAsync from 'run-async';
import BasePrompt from 'inquirer/lib/prompts/base';

import ShellPathAutocomplete from './ShellPathAutocomplete';

const TAB_KEY = 'tab';
const ENTER_KEY = 'return';
const RANGE_SIZE = 5;

/**
 * An {@link Inquirer} prompt for a single path. It supports auto completing paths similarly to zsh.
 */
export default class PathPrompt extends BasePrompt {
  /**
   * Create a new prompt instance
   * @param args
   */
  constructor(...args) {
    super(...args);
    /** @private */
    this.opt = Object.assign({
      filter: (value) => value,
      validate: () => true,
      validateMulti: () => true,
      when: () => true
    }, this.opt);

    const cwd = this.opt.cwd || this.opt.default || path.sep;

    /** @private */
    this.cancelCount = 0;
    /** @private */
    this.originalListeners = { SIGINT: this.rl.listeners('SIGINT') };
    /** @private */
    this.listeners = [];
    /** @private */
    this.answer = (this.opt.multi) ? [] : null;
    /** @private */
    this.shell = new ShellPathAutocomplete(cwd || process.cwd(), this.opt.directoryOnly);
    /** @private */
    this.opt.default = this.shell.getWorkingDirectory().getName();
    /** @private */
    this.state = {
      selectionActive: false
    };

    this.onSubmit = this.onSubmit.bind(this);
    this.onCancel = this.onCancel.bind(this);
    this.onKeyPress = this.onKeyPress.bind(this);

    this.rl.removeAllListeners('SIGINT');
  }

  /**
   * Runs the prompt.
   * @param {function} cb - A callback to call once the prompt has been answered successfully
   * @returns {PathPrompt}
   * @private
     */
  _run( cb ) {
    /** @private */
    this.done = cb;

    this.rl.addListener('line', this.onSubmit);
    this.rl.addListener('SIGINT', this.onCancel);
    this.rl.input.addListener('keypress', this.onKeyPress);

    this.render();
    return this;
  }

  /**
   * Hanldles keyPress events.
   * @param {Object} value - The string representing the pressed key
   * @param {Object} key - The information about the key pressed
   */
  onKeyPress(value, key = {}) {
    if (key.ctrl) {
      return;
    }
    this.cancelCount = 0;
    switch (key.name) {
      case TAB_KEY:
        this.shell.refresh();
        if (this.shell.hasCommonPotentialPath()) {
          this.state.selectionActive = false;
          this.shell.setInputPath(this.shell.getCommonPotentialPath());
        } else if (! this.state.selectionActive) {
          this.state.selectionActive = true;
        } else {
          this.shell.selectNextPotentialPath(!key.shift);
        }
        this.resetCursor();
        break;
      case ENTER_KEY:
        if (!this.shell.hasSelectedPath()) {
          // Let the onSubmit handler take care of that.
          return;
        }
        this.shell.setInputPath(this.shell.getSelectedPath());
        this.state.selectionActive = false;
        this.resetCursor();
        break;
      default:
        this.state.selectionActive = false;
        this.shell.setInputPath(this.rl.line);
        break;
    }
    // Avoid polluting the line value with whatever new characters the action key added to the line
    this.rl.line = this.shell.getInputPath(true);
    this.render();
  }

  /**
   * Event handler for when the user submits the current input.
   * It is triggered when the enter key is pressed.
   */
  onSubmit() {
    // Let the onKeypress handler take care of that one.
    if (this.shell.hasSelectedPath()) {
      return;
    }
    this.cancelCount = 0;
    const input = path.resolve(this.shell.getInputPathReference().getPath());
    runAsync(this.opt.validate, (isValid) => {
      if (isValid === true) {
        this.onSuccess(input);
      } else {
        this.onError(isValid);
      }
    }, input, this.answers);
  }

  /**
   * Event handler for cancel events (SIGINT)
   */
  onCancel(...args) {
    if (this.shell.hasSelectedPath()) {
      // Cancel the path selection
      this.state.selectionActive = false;
      this.shell.resetSelectPotentialPath();
    } else if (this.opt.multi && this.cancelCount < 1) {
      // Validate the multi path input
      runAsync(this.opt.validateMulti, (isValid) => {
        if (isValid === true) {
          this.onFinish();
        } else {
          this.cancelCount++;
          this.onError(isValid);
        }
      }, this.answer, this.answers);
    } else {
      // Exit out
      this.cleanup();
      this.originalListeners.SIGINT.forEach((listener) => listener(...args));
    }
  }

  /**
   * Handles validation errors.
   * @param {string} error - The validation error
   */
  onError(error) {
    // Keep the state
    this.rl.line = this.shell.getInputPath(true);
    this.resetCursor();
    this.renderError(error);
  }

  /**
   * Handles a successful submission.
   * @param {string} value - The resolved input path
   */
  onSuccess(value) {
    // Filter the value based on the options.
    this.filter(value, (filteredValue) => {
      // Re-render prompt with the final value
      this.render(filteredValue);

      if (this.opt.multi) {
        // Add a new line to keep the rendered answer
        this.rl.output.unmute();
        this.rl.output.write('\n');
        this.rl.output.mute();

        // Reset the shell
        this.shell.setInputPath('');
        this.shell.resetSelectPotentialPath();

        // Hide the selection if it was active
        this.state = {
          selectionActive: false
        };
        this.answer.push(filteredValue);

        // Render the new prompt
        this.render();
      } else {
        this.answer = filteredValue;
        this.onFinish();
      }
    });
  }

  /**
   * Handles the finish event
   */
  onFinish() {
    this.cleanup();
    this.screen.done();
    this.done(this.answer);
  }

  /**
   * Render the prompt
   */
  render(finalAnswer) {
    const message = this.renderMessage(finalAnswer);
    const bottom = finalAnswer ? '' : this.renderBottom();
    this.screen.render(message, bottom);
  }

  /**
   * Render errors during the prompt
   * @param error
   */
  renderError(error) {
    this.screen.render(this.renderMessage(), chalk.red('>> ') + error);
  }

  /**
   * Reset the input cursor to the end of the line
   */
  resetCursor() {
    // Move the display cursor
    this.rl.output.unmute();
    readline.cursorTo(this.rl.output, this.shell.getInputPath(true).length + 1);
    this.rl.output.mute();
    // Move the internal cursor
    this.rl.cursor = this.shell.getInputPath(true).length + 1;
  }

  /**
   * Render the message part of the prompt. The message includes the question and the current response.
   * @returns {String}
   */
  renderMessage(finalAnswer) {
    let message = this.getQuestion();
    if (finalAnswer) {
      message += chalk.cyan(finalAnswer);
    } else {
      message += this.shell.getInputPath(true);
    }
    return message;
  }

  /**
   * Render the bottom part of the prompt. The bottom part contains all the possible paths.
   * @returns {string}
   */
  renderBottom() {
    if (!this.state.selectionActive) {
      return '';
    }
    const potentialPaths = this.shell.getPotentialPaths();
    const selectedPath = this.shell.getSelectedPath();
    const selectedPathIndex = potentialPaths.indexOf(selectedPath);

    return this.slice(potentialPaths, selectedPathIndex, RANGE_SIZE)
      .map((potentialPath) => {
        const suffix = (potentialPath.isDirectory() ? path.sep : '');
        if (potentialPath === selectedPath) {
          return chalk.black.bgWhite(potentialPath.getName() + suffix);
        }
        return (potentialPath.isDirectory() ? chalk.red : chalk.green)(potentialPath.getName()) + suffix;
      })
      .join('\n');
  }

  /**
   * Slice an array around a specific item so that it contains a specific number of elements.
   * @param {Array<T>} items - The array of items which should be shortened
   * @param itemIndex - The index of the item that should be included in the returned slice
   * @param size - The desired size of the array to be returned
   * @returns {Array<T>} An array with the number of elements specified by size.
     */
  slice(items, itemIndex, size) {
    const length = items.length;
    let min = itemIndex - Math.floor(size / 2);
    let max = itemIndex + Math.ceil(size / 2);
    if (min < 0) {
      max = Math.min(length, max - min);
      min = 0;
    } else if (max >= length) {
      min = Math.max(0, min - (max - length));
      max = length;
    }
    return items.slice(min, max);
  }

  /**
   * Unregister the local event handlers and reregister the ones that were
   * removed.
   */
  cleanup() {
    Object.keys(this.originalListeners).forEach((eventName) => {
      this.originalListeners[eventName].forEach((listener) => {
        this.rl.addListener(eventName, listener);
      });
    });
    this.rl.removeListener('line', this.onSubmit);
    this.rl.removeListener('SIGINT', this.onCancel);
    this.rl.input.removeListener('keypress', this.onKeyPress);
  }
}

inquirer.prompt.registerPrompt('path', PathPrompt);
