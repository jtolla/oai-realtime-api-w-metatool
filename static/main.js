// Dynamic tool registry for storing created tools
const dynamicTools = {};

const fns = {
  createTool: ({ name, description, parameters, implementation, isAsync = false }) => {
    try {
      // Validate input
      if (!name || !description || !implementation) {
        return { success: false, error: 'Name, description, and implementation are required' };
      }

      // Parse parameters if provided as string
      let parsedParameters = parameters;
      if (typeof parameters === 'string') {
        try {
          parsedParameters = JSON.parse(parameters);
        } catch (e) {
          return { success: false, error: 'Invalid parameters JSON format' };
        }
      }

      // Create the function from the implementation string
      let createdFunction;
      try {
        if (isAsync) {
          createdFunction = new Function('args', `return (async () => { ${implementation} })()`);
        } else {
          createdFunction = new Function('args', implementation);
        }
      } catch (e) {
        return { success: false, error: `Invalid implementation code: ${e.message}` };
      }

      // Add to both fns and dynamicTools
      fns[name] = createdFunction;
      dynamicTools[name] = {
        description,
        parameters: parsedParameters || { type: 'object', properties: {} },
        implementation,
        isAsync,
        createdAt: new Date().toISOString()
      };

      // Update the session with the new tool
      updateSessionWithNewTool(name, description, parsedParameters);

      return {
        success: true,
        toolName: name,
        message: `Tool '${name}' created successfully`,
        availableTools: Object.keys(dynamicTools)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
  listDynamicTools: () => {
    const toolList = Object.entries(dynamicTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      parameters: tool.parameters,
      isAsync: tool.isAsync,
      createdAt: tool.createdAt
    }));
    return { success: true, tools: toolList, count: toolList.length };
  },
  removeTool: ({ name }) => {
    if (!dynamicTools[name]) {
      return { success: false, error: `Tool '${name}' not found` };
    }

    delete fns[name];
    delete dynamicTools[name];

    // Note: In a full implementation, you'd want to update the session
    // to remove the tool from OpenAI's available tools as well

    return {
      success: true,
      message: `Tool '${name}' removed successfully`,
      remainingTools: Object.keys(dynamicTools)
    };
  },
  executeCustomCode: ({ code, isAsync = false }) => {
    try {
      let result;
      if (isAsync) {
        const asyncFn = new Function(`return (async () => { ${code} })()`);
        result = asyncFn();
      } else {
        result = new Function(code)();
      }
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

// Create a WebRTC Agent
const peerConnection = new RTCPeerConnection();

// On inbound audio add to page
peerConnection.ontrack = (event) => {
  const el = document.createElement('audio');
  el.srcObject = event.streams[0];
  el.autoplay = true;
  el.controls = false;
  el.style.display = 'none';
  document.body.appendChild(el);
};

const dataChannel = peerConnection.createDataChannel('oai-events');

// Helper function to update session with new tool
function updateSessionWithNewTool(name, description, parameters) {
  const toolDefinition = {
    type: 'function',
    name: name,
    description: description
  };

  if (parameters) {
    toolDefinition.parameters = parameters;
  }

  const event = {
    type: 'session.update',
    session: {
      tools: [...getCurrentTools(), toolDefinition]
    }
  };

  if (dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(event));
  }
}

// Helper function to get current tools
function getCurrentTools() {
  return [
    {
      type: 'function',
      name: 'createTool',
      description: 'Dynamically creates a new JavaScript tool. Use this if a predefined tool does not exist.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the tool to create (must be a valid JavaScript function name)'
          },
          description: {
            type: 'string',
            description: 'A description of what the tool does'
          },
          parameters: {
            type: 'object',
            description: 'JSON schema defining the parameters the tool accepts'
          },
          implementation: {
            type: 'string',
            description: 'JavaScript code that implements the tool functionality. Use "args" to access parameters. Return a result object.'
          },
          isAsync: {
            type: 'boolean',
            description: 'Whether the tool implementation uses async/await (default: false)'
          }
        },
        required: ['name', 'description', 'implementation']
      }
    },
    {
      type: 'function',
      name: 'listDynamicTools',
      description: 'Lists all dynamically created tools with their metadata',
    },
    {
      type: 'function',
      name: 'removeTool',
      description: 'Removes a dynamically created tool',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name of the tool to remove' }
        },
        required: ['name']
      }
    },
    {
      type: 'function',
      name: 'executeCustomCode',
      description: 'Executes arbitrary JavaScript code in the browser context',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code to execute' },
          isAsync: { type: 'boolean', description: 'Whether the code uses async/await (default: false)' }
        },
        required: ['code']
      }
    },
    // Add dynamic tools
    ...Object.entries(dynamicTools).map(([name, tool]) => ({
      type: 'function',
      name: name,
      description: tool.description,
      parameters: tool.parameters
    }))
  ];
}

function configureData() {
  console.log('Configuring data channel');
  const event = {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      tools: getCurrentTools()
    },
  };
  dataChannel.send(JSON.stringify(event));
}

dataChannel.addEventListener('open', (ev) => {
  console.log('Opening data channel', ev);
  configureData();
});

dataChannel.addEventListener('message', async (ev) => {
  const msg = JSON.parse(ev.data);
  // Handle function calls
  if (msg.type === 'response.function_call_arguments.done') {
    const fn = fns[msg.name];
    if (fn !== undefined) {
      console.log(`Calling local function ${msg.name} with ${msg.arguments}`);
      const args = JSON.parse(msg.arguments);
      const result = await fn(args);
      console.log('result', result);
      // Let OpenAI know that the function has been called and share it's output
      const event = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: msg.call_id, // call_id from the function_call message
          output: JSON.stringify(result), // result of the function
        },
      };
      dataChannel.send(JSON.stringify(event));
      // Have assistant respond after getting the results
      dataChannel.send(JSON.stringify({ type: "response.create" }));
    }
  }
});

// Capture microphone
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  // Add microphone to PeerConnection
  stream.getTracks().forEach((track) => peerConnection.addTransceiver(track, { direction: 'sendrecv' }));

  peerConnection.createOffer().then((offer) => {
    peerConnection.setLocalDescription(offer);
    fetch('/session')
      .then((tokenResponse) => tokenResponse.json())
      .then((data) => {
        fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03', {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${data.client_secret.value}`,
            'Content-Type': 'application/sdp',
          },
        })
          .then((r) => r.text())
          .then((answer) => {
            // Accept answer from Realtime WebRTC API
            peerConnection.setRemoteDescription({
              sdp: answer,
              type: 'answer',
            });
          });
      });
  });
});