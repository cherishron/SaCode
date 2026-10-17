function teamPanelSnapshot(snapshot, runtimeStates = {}) {
  return {
    members: snapshot.members.map(member => ({
      id: member.id,
      role: member.role,
      sessionId: member.sessionId,
      status: member.active ? (runtimeStates[member.id] || 'idle') : 'stopped',
    })),
    tasks: snapshot.tasks.map(task => ({
      id: task.id,
      title: task.title,
      owner: task.owner || task.assignedTo || '',
      status: task.phase === 'in_progress' ? 'running' : task.phase,
      dependencies: [...task.dependencies],
      result: task.result || '',
    })),
    messages: snapshot.messages.map(message => ({
      id: message.id,
      sender: message.sender,
      target: message.recipient,
      text: message.text,
      status: message.delivered ? 'delivered' : 'pending',
    })),
  };
}
module.exports = {teamPanelSnapshot};
