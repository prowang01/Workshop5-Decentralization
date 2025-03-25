import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import axios from "axios";



// Structure d'un message envoyé entre les nœuds
type Message = {
  type: "R" | "P"
  x: Value | null
  k: number
  nodeId: number
}

// Variable globale pour stocker l'état de chaque nœud
declare global {
  var StatesOfNodes: Record<number, NodeState>;
}



export async function node(
  nodeId: number, // ID of the node
  N: number, // Total number of nodes
  F: number, // Max number of faulty nodes
  initialValue: Value, // Initial value (0 or 1)
  isFaulty: boolean, // Whether the node is faulty
  nodesAreReady: () => boolean, // Check if all nodes are ready
  setNodeIsReady: (index: number) => void // Mark node as ready
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());


  // TODO: initialize the global variable if it doesn't exist
  if (!globalThis.StatesOfNodes) {
    globalThis.StatesOfNodes = {};
  }

  // TODO: initialize the state of the node
  globalThis.StatesOfNodes[nodeId] = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  // TODO
  const messages: Record<number, Record<string, Message[]>> = {};


  // TODO: the function to store messages
  function storeMessage(message: Message): void {
    const { k, type } = message
    if(!messages[k]) messages[k] = {["R"]: [], ["P"]: []}
    // Check if the node ID is not already in the array before adding the message
    const nodeIdExists = messages[k][type].some(msg => msg.nodeId === message.nodeId);
    if (!nodeIdExists) {
      messages[k][type].push(message);
    }
  }
  
  // TODO: the function to get messages
  function getMessages(k: number, phase: "R" | "P"): Message[] {
    return messages[k][phase]
  }
  
  // TODO: the function to get the length of messages
  function getMessagesLen(k: number, phase: "R" | "P"): number {
    if (!messages[k]) return 0;
    return messages[k][phase].length
  }


  // TODO: the function to send messages to all nodes
  async function sendMessage(type: "R" | "P", k: number, x: Value | null) {
    for (let i = 0; i < N; i++) {
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, nodeId, k, x }),
      }).catch(() => {});
    }
  }

  // TODO: the function to count the value
  function countValue(messages: Message[]): Record<Value, number>{
    const valueCounts: Record<Value, number> = { 0: 0, 1: 0, "?": 0 };
    for (const msg of messages) {
      if (msg.x !== null) {
        valueCounts[msg.x] += 1;
      }
    }
    return valueCounts;
  }

  // TODO: the function to implement the Ben-Or consensus algorithm
  async function benOrAlgo() {
    while (!globalThis.StatesOfNodes[nodeId].decided) {
      if (globalThis.StatesOfNodes[nodeId].killed || isFaulty) return;
      
      globalThis.StatesOfNodes[nodeId].k! += 1;
      let k = globalThis.StatesOfNodes[nodeId].k!;
      let x = globalThis.StatesOfNodes[nodeId].x!;
      await sendMessage("R", k, x);

      while (getMessagesLen(k, "R") < N - F) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const messages_R = getMessages(k, "R");
      const nb_val_R = Object.entries(countValue(messages_R))
                      .filter(([_, count]) => count > N/2)
                      .map(([key, _]) => (key === "0" ? 0 : key === "1" ? 1 : "?")) as Value[];
      
      if (nb_val_R.length > 0){
        await sendMessage("P", k, nb_val_R[0]);
      }
      else{
        await sendMessage("P", k, "?")
      }

      while (getMessagesLen(k, "P")  < N - F) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const messages_P = getMessages(k, "P");
      const nb_val_P = Object.entries(countValue(messages_P))
                      .filter(([key, count]) => count >= F + 1 && key != "?")
                      .map(([key, _]) => (key === "0" ? 0 : 1)) as Value[];
      
      if (nb_val_P.length > 0){
        globalThis.StatesOfNodes[nodeId].x = nb_val_P[0];
        globalThis.StatesOfNodes[nodeId].decided = true;
      }
      else{
        const at_least = Object.entries(countValue(messages_P))
                      .filter(([key, count]) => count >= 1 && key != "?")
                      .map(([key, _]) => (key === "0" ? 0 : 1)) as Value[];
        
        if (at_least.length > 0) {
          globalThis.StatesOfNodes[nodeId].x = at_least[0];
        } 
        else {
          globalThis.StatesOfNodes[nodeId].x = Math.random() < 0.5 ? 0 : 1;
        }
      }
  }}



  // TODO implement this
  // this route allows retrieving the current status of the node
  // node.get("/status", (req, res) => {});
  node.get("/status", (req, res) => {
    if (isFaulty) { res.status(500).send("faulty"); } 
    else { res.status(200).send("live"); }
  });


  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
  node.post("/message", (req, res) => {
    if (globalThis.StatesOfNodes[nodeId].killed) {
      return res.status(400).send("Node is stopped");
    }

    const { type, nodeId:senderId, k, x } = req.body;

    if (!globalThis.StatesOfNodes[nodeId].decided) {
      storeMessage({ type, nodeId:senderId, k, x });
    }

    return res.status(200).send("Message received");
  });

  
  // TODO implement this
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});
  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      return res.status(400).send("Nodes are not ready");
    }

    benOrAlgo();
    return res.status(200).send("Consensus started");
  });


  // TODO implement this
  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});
  node.get("/stop", (req, res) => {
    globalThis.StatesOfNodes[nodeId].killed = true;
    res.status(200).send("Node stopped");
  });

  
  // TODO implement this
  // get the current state of a node
  // node.get("/getState", (req, res) => {});
  node.get("/getState", (req, res) => {
    res.status(200).json(globalThis.StatesOfNodes[nodeId]);
  });
  
  

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}