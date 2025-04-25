import React, { useState, useEffect, useRef, useCallback } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Mic, MicOff, SendHorizontal, Paperclip, X } from 'lucide-react'; // Import icons

// Define the interface for the SpeechRecognition API (including vendor prefixes)
interface CustomWindow extends Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
}
declare const window: CustomWindow;

// Updated structure for attached file state
interface AttachedFile {
    name: string;
    type: string; // MIME type
    dataUrl: string; // File content as Data URL
}

interface ChatInputProps {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    // Update onSend prop signature
    onSend: (text: string, file?: AttachedFile) => void;
    status: 'error' | 'submitted' | 'streaming' | 'ready'; // Add status prop
    onStop: () => void; // Add onStop prop
}


const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend, status, onStop }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null); // State for attached file
    const [isSpeechApiAvailable, setIsSpeechApiAvailable] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null); // Ref for file input
    const finalTranscriptRef = useRef<string>(''); // Stores final transcript *within* a single recognition event sequence
    const currentFinalizedTranscriptRef = useRef<string>(''); // Stores the input value *before* recording started + any final results from the current session

    // Check for SpeechRecognition API availability
    useEffect(() => {
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognitionAPI) {
            setIsSpeechApiAvailable(true);
        } else {
            console.warn("Web Speech API is not supported in this browser.");
            setStatusMessage("Voice input not supported by this browser.");
        }
    }, []);

    // Cleanup function to stop recognition if component unmounts
    useEffect(() => {
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
                console.log("Speech recognition stopped due to component unmount.");
            }
        };
    }, []);

    const handleSendClick = () => {
        // Send text and attached file data if present
        // Pass the full AttachedFile object
        if (value.trim() || attachedFile) {
            onSend(value, attachedFile ?? undefined);
            setAttachedFile(null); // Clear file after sending
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSendClick();
        }
    };

    const handleRecognitionResult = useCallback((event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let currentSegmentFinalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                currentSegmentFinalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Combine the text that was present before recording, the newly finalized text, and the current interim text
        const newText = (currentFinalizedTranscriptRef.current + ' ' + currentSegmentFinalTranscript + interimTranscript).trim();
        // Simulate a change event to update the input value via the hook's handler
        const syntheticEvent = {
            target: { value: newText }
        } as React.ChangeEvent<HTMLTextAreaElement>; // Cast to the expected type
        onChange(syntheticEvent);

        // If this segment contained final results, update the base finalized transcript for the next event
        if (currentSegmentFinalTranscript) {
            currentFinalizedTranscriptRef.current = (currentFinalizedTranscriptRef.current + ' ' + currentSegmentFinalTranscript).trim();
        }

    }, [onChange]);

    const handleRecognitionError = useCallback((event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error, event.message);
        let errorMessage = `Speech recognition error: ${event.error}`;
        if (event.error === 'no-speech') {
            errorMessage = "No speech detected. Please try again.";
        } else if (event.error === 'audio-capture') {
            errorMessage = "Microphone error. Please check your microphone.";
        } else if (event.error === 'not-allowed') {
            errorMessage = "Microphone access denied. Please allow microphone access in browser settings.";
        } else {
            errorMessage = `Error: ${event.message || event.error}`;
        }
        setStatusMessage(errorMessage);
        setIsRecording(false); // Ensure recording state is reset on error
        recognitionRef.current = null; // Clear ref on error
    }, []);

    const handleRecognitionEnd = useCallback(() => {
        console.log('Speech recognition ended.');
        setIsRecording(false);
        setStatusMessage(''); // Clear status message on normal end
        recognitionRef.current = null; // Clear ref on end
    }, []);


    const handleMicClick = () => {
        if (!isSpeechApiAvailable) {
            setStatusMessage("Voice input not supported.");
            return;
        }

        if (isRecording) {
            // Stop recording
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            setIsRecording(false);
            setStatusMessage('');
        } else {
            // Start recording
            const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognitionAPI) {
                setStatusMessage("Voice input not supported.");
                return; // Should not happen if isSpeechApiAvailable is true, but safety check
            }
            recognitionRef.current = new SpeechRecognitionAPI();
            recognitionRef.current.continuous = true; // Keep listening through pauses until explicitly stopped
            recognitionRef.current.interimResults = true; // Get interim results
            recognitionRef.current.lang = 'en-US'; // Set language

            recognitionRef.current.onresult = handleRecognitionResult;
            recognitionRef.current.onerror = handleRecognitionError;
            recognitionRef.current.onend = handleRecognitionEnd;


            try {
                recognitionRef.current.start();
                setIsRecording(true);
                setStatusMessage('Listening...');
                finalTranscriptRef.current = ''; // Reset segment final transcript
                currentFinalizedTranscriptRef.current = value; // Store current input value as the base
            } catch (error) {
                console.error("Error starting speech recognition:", error);
                setStatusMessage("Could not start voice input. Check permissions?");
                setIsRecording(false);
                recognitionRef.current = null;
            }
        }
    };

    // --- File Handling ---
    const handleAttachClick = () => {
        fileInputRef.current?.click(); // Trigger hidden file input
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                // Store name, type, and dataUrl
                setAttachedFile({ name: file.name, type: file.type, dataUrl });
                setStatusMessage(''); // Clear previous errors
            };
            reader.onerror = (e) => {
                console.error("Error reading file:", e);
                setStatusMessage(`Error reading file: ${file.name}`);
                setAttachedFile(null);
            };
            // Read as Data URL
            reader.readAsDataURL(file);
        }
        // Reset file input value so the same file can be selected again if removed
        if (event.target) {
            event.target.value = '';
        }
    };

    const handleRemoveFile = () => {
        setAttachedFile(null);
        setStatusMessage(''); // Clear any file-related messages
    };
    // --- End File Handling ---


    return (
        // Wrap input and status in a fragment or div
        <>
            {/* Main container with border */}
            <div className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                {/* File Bubble Area (Above Textarea) */}
                {attachedFile && (
                    <div className="px-2 pt-2 pb-1 border-b border-gray-200 dark:border-gray-700">
                        {/* File Bubble */}
                        <div className="inline-flex items-center bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2">
                            <Paperclip className="w-3 h-3 mr-1" />
                            <span className="truncate max-w-xs">{attachedFile.name}</span>
                            <button
                                type="button"
                                onClick={handleRemoveFile}
                                className="ml-1.5 -mr-1 p-0.5 rounded-full text-blue-500 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 focus:outline-none"
                                title="Remove file"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                        {/* Add more bubbles here if multiple files are supported later */}
                    </div>
                )}
                {/* Input Row */}
                <div className="flex items-end p-2">
                    {/* Hidden File Input */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        // Keep accept attribute, but reading method changed
                        accept="text/*,.json,.md,.csv,.py,.js,.ts,.html,.css,application/json,application/csv,application/xml,application/javascript,application/pdf,image/*"
                    />
                    {/* Attach File Button */}
                    <button
                        type="button"
                        className={`mr-2 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
                        onClick={handleAttachClick}
                        disabled={isRecording} // Disable while recording
                        title="Attach File" // Updated title
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                    <TextareaAutosize
                        minRows={1}
                        maxRows={6}
                        placeholder="Type message or attach file..." // Updated placeholder
                        className="flex-grow p-2 bg-transparent text-gray-900 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto"
                        value={value}
                        // Pass the onChange prop directly
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                    />
                    {/* Microphone Button */}
                    <button
                        type="button" // Explicitly set type to prevent form submission if wrapped in form later
                        className={`ml-2 p-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${isRecording
                            ? 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300' // Style when recording
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200' // Style when not recording
                            } ${!isSpeechApiAvailable ? 'opacity-50 cursor-not-allowed' : ''}`} // Style when disabled
                        onClick={handleMicClick}
                        disabled={!isSpeechApiAvailable}
                        title={isSpeechApiAvailable ? (isRecording ? 'Stop Recording' : 'Start Recording') : 'Voice input not supported'}
                    >
                        {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                    {/* Conditional Send/Stop Button */}
                    {status === 'submitted' || status === 'streaming' ? (
                        // Stop Button
                        <button
                            type="button"
                            className="ml-2 p-1.5 text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                            onClick={onStop} // Call the stop function from context
                            title="Stop Generation"
                        >
                            {/* Simple Square Stop Icon */}
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                            </svg>
                        </button>
                    ) : (
                        // Send Button
                        <button
                            type="button"
                            className="ml-2 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onClick={handleSendClick}
                            disabled={(!value.trim() && !attachedFile) || isRecording} // Disable send if recording or if input empty AND no file attached
                            title="Send"
                        >
                            <SendHorizontal className="w-5 h-5" /> {/* Using Lucide icon */}
                        </button>
                    )}
                </div>
            </div>
            {/* Status Message Area */}
            {statusMessage && (
                <div className="text-xs text-center text-red-600 dark:text-red-400 pt-1 h-4">
                    {statusMessage}
                </div>
            )}
            {/* Add placeholder div if no status message to maintain layout consistency */}
            {!statusMessage && <div className="h-4 pt-1"></div>}
        </>
    );
};

export default ChatInput;