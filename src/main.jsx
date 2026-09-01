import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// A tab held open across a deploy asks for a chunk hash that no longer exists,
// and an uncaught rejection empties #root. Nothing on a page about public
// records should be able to white-screen; if something does fail, say so and
// offer the one action that fixes it.
class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    // Left in the console on purpose: the message is the only diagnostic a
    // visitor can send back.
    console.error('Right Window failed to render:', err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    // The copy asserts nothing about the cause — an earlier version blamed a
    // stale deploy, and that confident guess hid a real crash for a day. State
    // the failure, say what the product is, offer the one action that helps.
    return (
      <div className="crash">
        <b>This page hit an error and stopped.</b>
        <p>
          Right Window reads New York City's public records and lists the buildings and businesses with a legal
          deadline — and the person to call about it. A reload usually brings the page back.
        </p>
        <button className="btn solid" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <Boundary>
    <App />
  </Boundary>,
);
