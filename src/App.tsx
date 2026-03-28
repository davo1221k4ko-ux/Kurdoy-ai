/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Trash2, 
  User as UserIcon, 
  Plus, 
  Menu, 
  Sparkles,
  Cpu,
  Search,
  GraduationCap,
  Code2,
  Globe,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  RotateCcw,
  LogOut,
  LogIn,
  Camera,
  X,
  Check,
  Paperclip
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { cn } from './lib/utils';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User,
  firebaseConfig,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';

interface GroundingSource {
  title: string;
  uri: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sources?: GroundingSource[];
  imageUrl?: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  type?: 'general' | 'search' | 'student' | 'coding' | 'image';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'google'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authError, setAuthError] = useState<React.ReactNode | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);

  const getAuthErrorCode = (err: any) => {
    if (!err) return '';
    if (err.code) return err.code;
    const msg = String(err.message || err || '').toLowerCase();
    if (msg.includes('invalid-credential') || msg.includes('invalid login credentials')) return 'auth/invalid-credential';
    if (msg.includes('user-not-found')) return 'auth/user-not-found';
    if (msg.includes('wrong-password')) return 'auth/wrong-password';
    if (msg.includes('invalid-email')) return 'auth/invalid-email';
    if (msg.includes('email-already-in-use')) return 'auth/email-already-in-use';
    if (msg.includes('weak-password')) return 'auth/weak-password';
    if (msg.includes('operation-not-allowed')) return 'auth/operation-not-allowed';
    if (msg.includes('account-exists-with-different-credential')) return 'auth/account-exists-with-different-credential';
    return '';
  };

  // Clear auth error when switching modes
  useEffect(() => {
    setAuthError(null);
  }, [authMode]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-save input to localStorage
  useEffect(() => {
    if (currentChatId) {
      const savedInput = localStorage.getItem(`kurdoy_input_${currentChatId}`);
      if (savedInput) setInput(savedInput);
    } else {
      const savedInput = localStorage.getItem('kurdoy_input_new');
      if (savedInput) setInput(savedInput);
    }
  }, [currentChatId]);

  useEffect(() => {
    const key = currentChatId ? `kurdoy_input_${currentChatId}` : 'kurdoy_input_new';
    if (input) {
      localStorage.setItem(key, input);
    } else {
      localStorage.removeItem(key);
    }
  }, [input, currentChatId]);

  // Image compression utility
  const compressImage = (dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });
  };
  const typeMenuRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Auth Listener
  useEffect(() => {
    // Fallback: If auth doesn't resolve in 5 seconds, stop loading
    // This prevents users from being stuck on the loading screen
    const timeout = setTimeout(() => {
      setIsAuthLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      clearTimeout(timeout);
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser) {
        // Create/Update user profile in Firestore
        const userRef = doc(db, 'users', currentUser.uid);
        setDoc(userRef, {
          uid: currentUser.uid,
          displayName: currentUser.displayName,
          email: currentUser.email,
          photoURL: currentUser.photoURL,
          updatedAt: new Date().toISOString()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`));
      } else {
        setChats([]);
        setCurrentChatId(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Chats
  useEffect(() => {
    if (!user) return;

    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('uid', '==', user.uid), orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const syncedChats: Chat[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          messages: [], // Messages will be loaded per chat
          createdAt: new Date(data.createdAt).getTime(),
          type: data.type
        };
      });
      setChats(syncedChats);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'chats'));

    return () => unsubscribe();
  }, [user]);

  // Firestore Sync: Messages for Current Chat
  useEffect(() => {
    if (!user || !currentChatId) return;

    const messagesRef = collection(db, `chats/${currentChatId}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const syncedMessages: Message[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          role: data.role,
          content: data.content,
          timestamp: data.timestamp,
          imageUrl: data.imageUrl,
          sources: data.sources
        };
      });

      setChats(prev => prev.map(chat => {
        if (chat.id === currentChatId) {
          return { ...chat, messages: syncedMessages };
        }
        return chat;
      }));
    }, (err) => handleFirestoreError(err, OperationType.LIST, `chats/${currentChatId}/messages`));

    return () => unsubscribe();
  }, [user, currentChatId]);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Global error caught:', event.error);
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  const currentChat = chats.find(c => c.id === currentChatId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeMenuRef.current && !typeMenuRef.current.contains(event.target as Node)) {
        setShowTypeMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.messages, isLoading]);

  const createNewChat = async (type: Chat['type'] | React.MouseEvent = 'general') => {
    if (!user) return;
    const actualType = typeof type === 'string' ? type : 'general';
    
    const chatId = Date.now().toString();
    const newChatData = {
      id: chatId,
      uid: user.uid,
      title: actualType === 'general' ? 'New Chat' : `${actualType.charAt(0).toUpperCase() + actualType.slice(1)} Chat`,
      type: actualType,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'chats', chatId), newChatData);
      setCurrentChatId(chatId);
      setShowTypeMenu(false);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}`);
    }
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraOpen(true);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Could not access camera. Please check permissions.");
    }
  };

  const closeCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = async () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        const compressed = await compressImage(dataUrl);
        setCapturedImage(compressed);
        closeCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        const compressed = await compressImage(dataUrl);
        setCapturedImage(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'chats', id));
      if (currentChatId === id) setCurrentChatId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${id}`);
    }
  };

  const loginWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      try {
        console.error('Google Login Error:', err);
        const errorCode = getAuthErrorCode(err);
        
        if (errorCode === 'auth/operation-not-allowed') {
          const consoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;
          setAuthError(
            <span>
              Google Sign-In is not enabled. Please enable it in the{' '}
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold">
                Firebase Console
              </a>.
            </span>
          );
        } else if (errorCode === 'auth/invalid-credential') {
          setAuthError('Email or password is not right.');
        } else if (errorCode === 'auth/account-exists-with-different-credential') {
          setAuthError('Email already exists with a different sign-in method.');
        } else {
          setAuthError(String(err?.message || err || 'Failed to sign in with Google'));
        }
      } catch (innerErr) {
        console.error('Nested Google Login Error:', innerErr);
        setAuthError('An unexpected error occurred during Google sign-in.');
      }
    }
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!email || !password || !displayName) {
      setAuthError('Please fill in all fields');
      return;
    }
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName });
      
      // Manually sync to Firestore to ensure displayName is captured immediately
      const userRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userRef, {
        uid: userCredential.user.uid,
        displayName: displayName,
        email: userCredential.user.email,
        photoURL: null,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      
    } catch (err: any) {
      try {
        console.error('Signup Error:', err);
        const errorCode = getAuthErrorCode(err);

        if (errorCode === 'auth/operation-not-allowed') {
          const consoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;
          setAuthError(
            <span>
              Email/Password authentication is not enabled. Please enable it in the{' '}
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold">
                Firebase Console
              </a>.
            </span>
          );
        } else if (errorCode === 'auth/email-already-in-use') {
          setAuthError('Email already in use.');
        } else if (errorCode === 'auth/weak-password') {
          setAuthError('Password is too weak.');
        } else if (errorCode === 'auth/invalid-email') {
          setAuthError('Email format is not right.');
        } else if (errorCode === 'auth/invalid-credential') {
          setAuthError('Email or password is not right.');
        } else {
          setAuthError(String(err?.message || err || 'Failed to create account'));
        }
      } catch (innerErr) {
        console.error('Nested Signup Error:', innerErr);
        setAuthError('An unexpected error occurred during signup.');
      }
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (!email || !password) {
      setAuthError('Please enter both email and password');
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      try {
        console.error('Login Error:', err);
        const errorCode = getAuthErrorCode(err);

        if (errorCode === 'auth/operation-not-allowed') {
          const consoleUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;
          setAuthError(
            <span>
              Email/Password authentication is not enabled. Please enable it in the{' '}
              <a href={consoleUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold">
                Firebase Console
              </a>.
            </span>
          );
        } else if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
          setAuthError('Email or password is not right.');
        } else if (errorCode === 'auth/invalid-email') {
          setAuthError('Email format is not right.');
        } else if (errorCode === 'auth/account-exists-with-different-credential') {
          setAuthError('Email already exists with a different sign-in method.');
        } else {
          setAuthError(String(err?.message || err || 'Invalid email or password'));
        }
      } catch (innerErr) {
        console.error('Nested Login Error:', innerErr);
        setAuthError('An unexpected error occurred during login.');
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout Error:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !currentChatId || isLoading || !user) return;

    if (input.length > 4000) {
      setRateLimitError("Message is too long. Please shorten it.");
      setTimeout(() => setRateLimitError(null), 5000);
      return;
    }

    // Rate Limiting Logic
    const MESSAGE_LIMIT = 20;
    const RESET_PERIOD = 2 * 60 * 60 * 1000; // 2 hours in ms
    
    const now = Date.now();
    let rateLimitData = { count: 0, startTime: 0 };
    try {
      rateLimitData = JSON.parse(localStorage.getItem('kurdoy_rate_limit') || '{"count": 0, "startTime": 0}');
    } catch (e) {
      console.error('Rate limit parse error:', e);
    }
    
    if (rateLimitData.startTime === 0 || (now - rateLimitData.startTime) > RESET_PERIOD) {
      // Reset window
      try {
        localStorage.setItem('kurdoy_rate_limit', JSON.stringify({ count: 1, startTime: now }));
      } catch (e) {
        console.warn('Rate limit save error:', e);
      }
    } else if (rateLimitData.count >= MESSAGE_LIMIT) {
      const timeLeft = Math.ceil((RESET_PERIOD - (now - rateLimitData.startTime)) / (60 * 1000));
      const hours = Math.floor(timeLeft / 60);
      const minutes = timeLeft % 60;
      const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      
      setRateLimitError(`You've reached the message limit. Please come back in ${timeStr}.`);
      setTimeout(() => setRateLimitError(null), 5000);
      return;
    } else {
      // Increment count
      try {
        localStorage.setItem('kurdoy_rate_limit', JSON.stringify({ 
          count: rateLimitData.count + 1, 
          startTime: rateLimitData.startTime 
        }));
      } catch (e) {
        console.warn('Rate limit save error:', e);
      }
    }

    const userMessage: any = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    if (capturedImage) {
      userMessage.imageUrl = capturedImage;
    }

    setIsLoading(true);
    setInput('');
    const key = currentChatId ? `kurdoy_input_${currentChatId}` : 'kurdoy_input_new';
    localStorage.removeItem(key);
    setCapturedImage(null); // Clear captured image after sending

    try {
      // Save user message to Firestore
      const userMsgRef = doc(db, `chats/${currentChatId}/messages`, userMessage.id);
      await setDoc(userMsgRef, { ...userMessage, uid: user.uid, chatId: currentChatId });
      
      // Update chat's updatedAt and title if it's the first message
      const chatRef = doc(db, 'chats', currentChatId);
      const chatSnap = await getDoc(chatRef);
      if (chatSnap.exists() && (!chatSnap.data().messages || chatSnap.data().messages.length === 0)) {
        await updateDoc(chatRef, {
          updatedAt: new Date().toISOString(),
          title: input.slice(0, 30) + (input.length > 30 ? '...' : '')
        });
      } else {
        await updateDoc(chatRef, { updatedAt: new Date().toISOString() });
      }

      // Check if it's an image request (explicit mode or keywords)
      const currentMessageText = input;
      const isExplicitImageMode = currentChat?.type === 'image';
      const hasImageKeywords = /\b(image|picture|photo|drawing|painting|art|sketch|illustration|gen|generate|make|draw|create|can u|can you|cartoon|edit)\b/i.test(currentMessageText);
      const shouldTryImage = isExplicitImageMode || (currentChat?.type === 'general' && hasImageKeywords) || userMessage.imageUrl;

      const apiKey = process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      let systemInstruction = "You are kurdoy.ai, a helpful and intelligent Kurdish AI assistant. You were made by Davar and are powered by Davar. You have the capability to generate images, search the web, and help with coding or studies. Be concise in your responses unless a detailed explanation is requested. IMPORTANT: If you want to generate an image, you MUST output ONLY a JSON block in this exact format: { \"action\": \"kurdoy_image_gen\", \"action_input\": \"detailed prompt for the image\" }. DO NOT include any other text, markdown code blocks, or explanations when you output this JSON. Just output the JSON object itself.";

      if (currentChat?.type === 'coding') {
        systemInstruction += " You are a world-class coding expert. Provide clean, efficient, and well-documented code. Explain complex concepts simply.";
      } else if (currentChat?.type === 'student') {
        systemInstruction += " You are a dedicated student tutor. Help with homework, explain academic concepts, and encourage critical thinking. Use analogies and step-by-step guides.";
      } else if (currentChat?.type === 'search') {
        systemInstruction += " You are a research specialist. Use Google Search to find the most accurate and up-to-date information. Cite your sources clearly.";
      } else if (currentChat?.type === 'image') {
        systemInstruction += " You are a creative artist. When a user asks for an image, output the JSON block. When a user asks for an image of a famous person (like YouTubers IShowSpeed, MrBeast, streamers, or TikTokers), brand, or current event, use your internal knowledge to describe their exact appearance in detail in the action_input. Your primary goal is to create high-quality, accurate visual content based on user prompts.";
      } else {
        systemInstruction += " You are a specialist in Student Support and Coding. You have access to Google Search for text queries to provide accurate information. You CAN generate images directly in this chat by outputting the JSON block. If a user asks for an image of a famous person (especially YouTubers, Streamers, or TikTokers) or brand, use your internal knowledge to ensure visual accuracy. If a user asks if you can make images, answer 'Yes, I can! What would you like me to generate?' and then wait for their prompt.";
      }
      
      systemInstruction += " Always remember and mention if asked that you are kurdoy.ai, Made by Davar, and Powered by Davar. You are a Kurdish AI.";
      systemInstruction += " You can also see images sent by the user via their camera. If a user sends an image and asks to 'cartoonize' it or 'edit' it, describe how you would change it and then output the JSON block to generate the new version. For example: { \"action\": \"kurdoy_image_gen\", \"action_input\": \"a cartoon version of the person in the provided image, vibrant colors, Pixar style\" }.";

      const chatHistory = currentChat?.messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })) || [];

      // Limit history to last 10 messages to prevent context overflow and keep responses focused
      const history = chatHistory.slice(-10);
      const userParts: any[] = [{ text: currentMessageText }];
      if (userMessage.imageUrl) {
        userParts.push({
          inlineData: {
            data: userMessage.imageUrl.split(',')[1],
            mimeType: 'image/png'
          }
        });
      }

      let response;
      let imageUrl: string | undefined;
      let responseText = "";
      const sources: GroundingSource[] = [];

      const findImageGenAction = (text: string) => {
        // More robust regex to handle potential markdown formatting, different quotes, and spacing
        const regex = /\{[\s\S]*?"action"[\s\S]*?"kurdoy_image_gen"[\s\S]*?"action_input"[\s\S]*?"([\s\S]*?)"[\s\S]*?\}/;
        const match = text.match(regex);
        if (match) {
          return {
            prompt: match[1].replace(/\\"/g, '"'), // Unescape quotes if any
            fullMatch: match[0]
          };
        }
        return null;
      };

      if (shouldTryImage) {
        try {
          // Use the free model to keep the app free
          response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [
              ...history,
              { role: 'user', parts: userParts }
            ],
            config: {
              systemInstruction: systemInstruction,
            }
          });

          let foundImage = false;
          for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              const rawUrl = `data:image/png;base64,${part.inlineData.data}`;
              imageUrl = await compressImage(rawUrl);
              foundImage = true;
            } else if (part.text) {
              responseText += part.text;
            }
          }

          // Check if the image model returned a JSON action instead of an image
          const action = findImageGenAction(responseText);
          if (action && !foundImage) {
            const imgParts: any[] = [{ text: action.prompt }];
            if (userMessage.imageUrl) {
              imgParts.push({
                inlineData: {
                  data: userMessage.imageUrl.split(',')[1],
                  mimeType: 'image/png'
                }
              });
            }

            const imgResponse = await ai.models.generateContent({
              model: "gemini-2.5-flash-image",
              contents: [
                ...history,
                { role: 'user', parts: imgParts }
              ],
              config: {
                systemInstruction: systemInstruction,
              }
            });

            for (const part of imgResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                const rawUrl = `data:image/png;base64,${part.inlineData.data}`;
                imageUrl = await compressImage(rawUrl);
                foundImage = true;
                responseText = responseText.replace(action.fullMatch, "").trim();
                // Also strip markdown code blocks if they were wrapped around it
                responseText = responseText.replace(/```json\s*|```\s*/g, "").trim();
                break;
              }
            }
          }

          // If we were in general mode but didn't actually get an image, fallback to text model
          if (!foundImage && !isExplicitImageMode) {
            throw new Error("No image generated, falling back to text");
          }
        } catch (imgError) {
          if (isExplicitImageMode) throw imgError;
          // Fallback to text model if image generation fails in general mode
          const textResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
              ...history,
              { role: 'user', parts: userParts }
            ],
            config: {
              systemInstruction: systemInstruction,
              tools: [{ googleSearch: {} }],
            }
          });
          response = textResponse; // Update response for grounding extraction
          responseText = textResponse.text || "";
        }
      } else {
        response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            ...history,
            { role: 'user', parts: userParts }
          ],
          config: {
            systemInstruction: systemInstruction,
            tools: [{ googleSearch: {} }],
          }
        });
        responseText = response.text || "";
      }

      // Final check for image gen action in the final responseText (from either model)
      const finalAction = findImageGenAction(responseText);
      if (finalAction && !imageUrl) {
        try {
          const imgParts: any[] = [{ text: finalAction.prompt }];
          if (userMessage.imageUrl) {
            imgParts.push({
              inlineData: {
                data: userMessage.imageUrl.split(',')[1],
                mimeType: 'image/png'
              }
            });
          }

          const imgResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: [
              ...history,
              { role: 'user', parts: imgParts }
            ],
            config: {
              systemInstruction: systemInstruction,
            }
          });

          for (const part of imgResponse.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              const rawUrl = `data:image/png;base64,${part.inlineData.data}`;
              imageUrl = await compressImage(rawUrl);
              responseText = responseText.replace(finalAction.fullMatch, "").trim();
              responseText = responseText.replace(/```json\s*|```\s*/g, "").trim();
              break;
            }
          }
        } catch (err) {
          console.error("Secondary image gen failed:", err);
        }
      }

      // Extract grounding sources if available
      if (response?.candidates?.[0]?.groundingMetadata?.groundingChunks) {
        const groundingChunks = response.candidates[0].groundingMetadata.groundingChunks;
        groundingChunks.forEach((chunk: any) => {
          if (chunk.web && chunk.web.uri) {
            sources.push({
              title: chunk.web.title || "Source",
              uri: chunk.web.uri
            });
          }
        });
      }

      const assistantMessage: any = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText || (imageUrl ? "" : 'Sorry, I couldn\'t generate a response.'),
        timestamp: Date.now(),
      };

      if (sources.length > 0) assistantMessage.sources = sources;
      if (imageUrl) assistantMessage.imageUrl = imageUrl;

      // Save assistant message to Firestore
      const assistantMsgRef = doc(db, `chats/${currentChatId}/messages`, assistantMessage.id);
      await setDoc(assistantMsgRef, { ...assistantMessage, uid: user.uid, chatId: currentChatId });

    } catch (error: any) {
      console.error('Gemini Error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error.message || 'Something went wrong with the AI service.'}`,
        timestamp: Date.now(),
      };
      
      if (currentChatId) {
        const errorMsgRef = doc(db, `chats/${currentChatId}/messages`, errorMessage.id);
        await setDoc(errorMsgRef, { ...errorMessage, uid: user.uid, chatId: currentChatId });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="h-screen w-full bg-[#09090b] flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center"
        >
          <Sparkles className="w-6 h-6 text-white" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full bg-[#09090b] flex flex-col items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-md w-full bg-[#121214] border border-white/5 rounded-3xl p-8 text-center shadow-2xl my-8"
        >
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-blue-900/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight">kurdoy.ai</h1>
          <p className="text-zinc-400 mb-2">Your intelligent Kurdish companion.</p>
          <p className="text-xs text-zinc-500 mb-8 uppercase tracking-widest font-bold">Made by Davar • Powered by Davar</p>
          
          <AnimatePresence mode="wait">
            {authError && (
              <motion.div
                key="auth-error"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
              >
                {authError}
              </motion.div>
            )}
          </AnimatePresence>

          {authMode === 'login' ? (
            <form onSubmit={handleEmailLogin} className="space-y-4 mb-6">
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-all text-white"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-all text-white"
                required
              />
              <button
                type="submit"
                className="w-full p-4 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20"
              >
                Sign In
              </button>
              <p className="text-sm text-zinc-500">
                Don't have an account?{' '}
                <button 
                  type="button"
                  onClick={() => setAuthMode('signup')}
                  className="text-blue-400 hover:underline"
                >
                  Sign Up
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleEmailSignup} className="space-y-4 mb-6">
              <input
                type="text"
                placeholder="Full Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-all text-white"
                required
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-all text-white"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 rounded-xl bg-white/5 border border-white/10 focus:border-blue-500 focus:outline-none transition-all text-white"
                required
              />
              <button
                type="submit"
                className="w-full p-4 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20"
              >
                Create Account
              </button>
              <p className="text-sm text-zinc-500">
                Already have an account?{' '}
                <button 
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className="text-blue-400 hover:underline"
                >
                  Sign In
                </button>
              </p>
            </form>
          )}

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/5"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#121214] px-2 text-zinc-500">Or continue with</span>
            </div>
          </div>
          
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center gap-3 p-4 rounded-xl bg-white text-black font-bold hover:bg-zinc-200 transition-all mb-4"
          >
            <LogIn className="w-5 h-5" />
            Google Account
          </button>
          
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
            Secure & Private
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="fixed md:relative z-40 w-72 h-full bg-[#121214] border-r border-white/5 flex flex-col"
          >
            <div className="p-4 flex flex-col h-full relative">
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="absolute -right-3 top-1/2 -translate-y-1/2 z-50 p-1.5 rounded-full bg-[#121214] border border-white/10 text-zinc-400 hover:text-white transition-all shadow-xl md:flex hidden"
                title="Close Sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                    <Cpu className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-bold text-lg tracking-tight">kurdoy.ai</span>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="md:hidden p-2 text-zinc-400 hover:text-white"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>

              <button
                onClick={createNewChat}
                className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all group mb-6"
              >
                <Plus className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                <span className="font-medium">New Chat</span>
              </button>

              <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 px-2">Recent Chats</div>
                {chats.map(chat => (
                  <button
                    key={chat.id}
                    onClick={() => setCurrentChatId(chat.id)}
                    className={cn(
                      "flex items-center justify-between w-full p-3 rounded-xl transition-all group",
                      currentChatId === chat.id ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                    )}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Sparkles className={cn("w-4 h-4 shrink-0", currentChatId === chat.id ? "text-blue-400" : "text-zinc-500")} />
                      <span className="truncate text-sm">{chat.title}</span>
                    </div>
                    <Trash2
                      onClick={(e) => deleteChat(chat.id, e)}
                      className="w-4 h-4 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all shrink-0"
                    />
                  </button>
                ))}
              </div>

              <div className="mt-auto pt-4 border-t border-white/5 space-y-2">
                <button
                  onClick={logout}
                  className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-all group"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="text-sm font-medium">Sign Out</span>
                </button>
                <button
                  onClick={() => {
                    localStorage.removeItem('kurdoy_rate_limit');
                    window.location.reload();
                  }}
                  className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-all group"
                  title="Reset message limits for testing"
                >
                  <RotateCcw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
                  <span className="text-sm font-medium">Reset Limits (Test)</span>
                </button>
                <div className="flex items-center gap-3 p-3 text-zinc-500">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs font-medium uppercase tracking-wider">System Online</span>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-white/5 flex items-center justify-between px-4 bg-[#09090b]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
              title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
            >
              {isSidebarOpen ? (
                <ChevronLeft className="w-5 h-5 text-zinc-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-zinc-400" />
              )}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-lg tracking-tight">kurdoy.ai</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center overflow-hidden">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-4 h-4 text-zinc-400" />
              )}
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {!currentChatId ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-2xl mx-auto">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center shadow-2xl shadow-blue-900/40 mb-8"
              >
                <Sparkles className="w-10 h-10 text-white" />
              </motion.div>
              <h2 className="text-4xl font-bold mb-4 tracking-tight">How can I help today?</h2>
              <p className="text-zinc-400 mb-12 text-lg">Your intelligent companion for coding, student life, and creative exploration.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                {[
                  { icon: <Plus className="w-4 h-4" />, text: "Start a new project", action: () => createNewChat('general') },
                  { icon: <Search className="w-4 h-4" />, text: "Search the web", action: () => createNewChat('search') },
                  { icon: <ImageIcon className="w-4 h-4" />, text: "Generate images", action: () => createNewChat('image') },
                  { icon: <GraduationCap className="w-4 h-4" />, text: "Student study help", action: () => createNewChat('student') },
                  { icon: <Code2 className="w-4 h-4" />, text: "Coding assistant", action: () => createNewChat('coding') },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={item.action}
                    className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 transition-all text-left flex items-center gap-3 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center group-hover:bg-zinc-700 transition-colors">
                      {item.icon}
                    </div>
                    <span className="font-medium text-zinc-300">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto w-full py-8 px-4 space-y-8">
              {currentChat.messages.length === 0 && (
                <div className="text-center py-20">
                  <p className="text-zinc-500 font-medium italic">Start typing to begin your conversation with kurdoy.ai</p>
                </div>
              )}
              {currentChat.messages.map((message) => (
                <motion.div
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  key={message.id}
                  className={cn(
                    "flex flex-col gap-2",
                    message.role === 'user' ? "items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "flex gap-4 group",
                    message.role === 'user' ? "flex-row-reverse" : "flex-row"
                  )}>
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-blue-900/20">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed",
                      message.role === 'user' 
                        ? "bg-zinc-800 text-zinc-100 border border-white/5" 
                        : "bg-transparent text-zinc-200"
                    )}>
                      <div className="prose prose-invert max-w-none">
                        <Markdown>{message.content}</Markdown>
                      </div>
                      {message.imageUrl && (
                        <div className="mt-4 rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-zinc-900/50">
                          <img 
                            src={message.imageUrl} 
                            alt="Generated by AI" 
                            className="w-full h-auto object-cover max-h-[512px] hover:scale-[1.02] transition-transform duration-500"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0 mt-1 border border-white/10 overflow-hidden">
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                        ) : (
                          <UserIcon className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                    )}
                  </div>
                  
                  {message.sources && message.sources.length > 0 && (
                    <div className="ml-12 mt-2 flex flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 uppercase tracking-widest font-bold mb-1 w-full">
                        <Globe className="w-3 h-3" />
                        Sources
                      </div>
                      {message.sources.map((source, idx) => (
                        <a
                          key={idx}
                          href={source.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-xs text-zinc-400 hover:text-zinc-200"
                        >
                          <span className="truncate max-w-[150px]">{source.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex gap-4 animate-pulse">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/50 flex items-center justify-center shrink-0 mt-1">
                    <Sparkles className="w-4 h-4 text-white/50" />
                  </div>
                  <div className="bg-white/5 h-12 w-24 rounded-2xl" />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent">
          <div className="max-w-4xl mx-auto relative">
            <div className="relative flex items-end gap-2">
            <div className="relative" ref={typeMenuRef}>
              <button
                onClick={() => setShowTypeMenu(!showTypeMenu)}
                className="p-3 rounded-2xl bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all mb-1"
                title="Select Chat Type"
              >
                <Plus className={cn("w-6 h-6 transition-transform", showTypeMenu && "rotate-45")} />
              </button>

              <AnimatePresence>
                {showTypeMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-0 mb-4 w-56 bg-[#121214] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    <div className="p-2 space-y-1">
                      {[
                        { id: 'general', icon: <Sparkles className="w-4 h-4" />, label: 'General Chat', color: 'text-blue-400' },
                        { id: 'search', icon: <Search className="w-4 h-4" />, label: 'Search Mode', color: 'text-emerald-400' },
                        { id: 'image', icon: <ImageIcon className="w-4 h-4" />, label: 'Image Gen', color: 'text-pink-400' },
                        { id: 'student', icon: <GraduationCap className="w-4 h-4" />, label: 'Student Help', color: 'text-amber-400' },
                        { id: 'coding', icon: <Code2 className="w-4 h-4" />, label: 'Coding Mode', color: 'text-purple-400' },
                      ].map((type) => (
                        <button
                          key={type.id}
                          onClick={() => createNewChat(type.id as Chat['type'])}
                          className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-300 hover:text-white transition-all text-left"
                        >
                          <div className={cn("shrink-0", type.color)}>{type.icon}</div>
                          <span className="text-sm font-medium">{type.label}</span>
                        </button>
                      ))}
                      <div className="h-px bg-white/5 my-1" />
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-300 hover:text-white transition-all text-left"
                      >
                        <div className="shrink-0 text-blue-400"><Camera className="w-4 h-4" /></div>
                        <span className="text-sm font-medium">Camera App</span>
                      </button>
                      <button
                        onClick={openCamera}
                        className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-300 hover:text-white transition-all text-left"
                      >
                        <div className="shrink-0 text-blue-400"><Camera className="w-4 h-4" /></div>
                        <span className="text-sm font-medium">In-App Camera</span>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-zinc-300 hover:text-white transition-all text-left"
                      >
                        <div className="shrink-0 text-emerald-400"><Paperclip className="w-4 h-4" /></div>
                        <span className="text-sm font-medium">Upload Image</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            <div className="relative flex-1">
              <AnimatePresence>
                {rateLimitError && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-0 right-0 mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs text-center backdrop-blur-md"
                  >
                    {rateLimitError}
                  </motion.div>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {capturedImage && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute bottom-full left-0 mb-4 p-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-40"
                  >
                    <div className="relative group">
                      <img src={capturedImage} alt="Captured" className="w-32 h-32 object-cover rounded-xl" />
                      <button
                        onClick={() => setCapturedImage(null)}
                        className="absolute -top-2 -right-2 p-1 rounded-full bg-red-500 text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={currentChatId ? `Message kurdoy.ai (${currentChat?.type || 'general'})...` : "Select or create a chat to begin..."}
                disabled={!currentChatId || isLoading}
                className="w-full bg-zinc-900 border border-white/10 rounded-2xl p-4 pr-14 focus:outline-none focus:ring-2 focus:ring-blue-600/50 focus:border-blue-600/50 transition-all resize-none min-h-[60px] max-h-48 custom-scrollbar"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || !currentChatId || isLoading}
                className="absolute right-3 bottom-3 p-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white transition-all shadow-lg shadow-blue-900/20"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-center mt-3 text-zinc-600 font-medium uppercase tracking-widest">
            kurdoy.ai — Kurdish AI • Made by Davar • Powered by Davar
          </p>
        </div>
      </main>

      <AnimatePresence>
        {isCameraOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-4"
          >
            <div className="relative w-full max-w-2xl aspect-video bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              
              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-6">
                <button
                  onClick={closeCamera}
                  className="p-4 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-md border border-white/10 transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
                <button
                  onClick={capturePhoto}
                  className="p-6 rounded-full bg-white text-black hover:bg-zinc-200 transition-all shadow-2xl"
                >
                  <Camera className="w-8 h-8" />
                </button>
              </div>
            </div>
            <p className="mt-6 text-zinc-400 font-medium uppercase tracking-widest text-xs">kurdoy.ai Camera Mode</p>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        
        .prose pre {
          background: #18181b !important;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1rem;
        }
        .prose code {
          color: #e4e4e7 !important;
          background: rgba(255, 255, 255, 0.05);
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          font-size: 0.875em;
        }
        .prose p {
          margin-bottom: 1rem;
        }
      `}</style>
    </div>
  );
}
