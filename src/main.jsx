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
    return (
      <div className="crash">
        <b>This page stopped loading.</b>
        <p>Usually it means the site was updated while you had it open. Reloading picks up the new version.</p>
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
