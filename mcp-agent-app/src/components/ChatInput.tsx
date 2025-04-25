import React, { useState, useEffect, useRef, useCallback } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Mic, MicOff, SendHorizontal, Paperclip, X } from 'lucide-react'; // Import icons

// Define the interface for the SpeechRecognition API (including vendor prefixes)
interface CustomWindow extends Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
}
declare const window: CustomWindow;

// Structure for attached file state
interface AttachedFile {
    name: string;
    type: string; // MIME type
    dataUrl: string; // File content as Data URL
}

interface ChatInputProps {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    // Update onSend prop signature to accept an array of files
    onSend: (text: string, files?: AttachedFile[]) => void;
    status: 'error' | 'submitted' | 'streaming' | 'ready'; // Add status prop
    onStop: () => void; // Add onStop prop
}


const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend, status, onStop }) => {
    const [isRecording, setIsRecording] = useState(false);
    // Change state to hold an array of files
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [isSpeechApiAvailable, setIsSpeechApiAvailable] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null); // Ref for file input
    const finalTranscriptRef = useRef<string>('');
    const currentFinalizedTranscriptRef = useRef<string>('');

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
        // Send text and attached files array
        if (value.trim() || attachedFiles.length > 0) {
            onSend(value, attachedFiles.length > 0 ? attachedFiles : undefined);
            setAttachedFiles([]); // Clear files array after sending
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
        const newText = (currentFinalizedTranscriptRef.current + ' ' + currentSegmentFinalTranscript + interimTranscript).trim();
        const syntheticEvent = { target: { value: newText } } as React.ChangeEvent<HTMLTextAreaElement>;
        onChange(syntheticEvent);
        if (currentSegmentFinalTranscript) {
            currentFinalizedTranscriptRef.current = (currentFinalizedTranscriptRef.current + ' ' + currentSegmentFinalTranscript).trim();
        }
    }, [onChange]);

    const handleRecognitionError = useCallback((event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error, event.message);
        let errorMessage = `Speech recognition error: ${event.error}`;
        if (event.error === 'no-speech') errorMessage = "No speech detected.";
        else if (event.error === 'audio-capture') errorMessage = "Microphone error.";
        else if (event.error === 'not-allowed') errorMessage = "Microphone access denied.";
        else errorMessage = `Error: ${event.message || event.error}`;
        setStatusMessage(errorMessage);
        setIsRecording(false);
        recognitionRef.current = null;
    }, []);

    const handleRecognitionEnd = useCallback(() => {
        console.log('Speech recognition ended.');
        setIsRecording(false);
        setStatusMessage('');
        recognitionRef.current = null;
    }, []);


    const handleMicClick = () => {
        if (!isSpeechApiAvailable) {
            setStatusMessage("Voice input not supported.");
            return;
        }
        if (isRecording) {
            recognitionRef.current?.stop();
            setIsRecording(false);
            setStatusMessage('');
        } else {
            const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognitionAPI) return;
            recognitionRef.current = new SpeechRecognitionAPI();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'en-US';
            recognitionRef.current.onresult = handleRecognitionResult;
            recognitionRef.current.onerror = handleRecognitionError;
            recognitionRef.current.onend = handleRecognitionEnd;
            try {
                recognitionRef.current.start();
                setIsRecording(true);
                setStatusMessage('Listening...');
                finalTranscriptRef.current = '';
                currentFinalizedTranscriptRef.current = value;
            } catch (error) {
                console.error("Error starting speech recognition:", error);
                setStatusMessage("Could not start voice input.");
                setIsRecording(false);
                recognitionRef.current = null;
            }
        }
    };

    // --- File Handling ---
    const handleAttachClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (files && files.length > 0) {
            // Read multiple files
            const filePromises = Array.from(files).map(file => {
                return new Promise<AttachedFile>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const dataUrl = e.target?.result as string;
                        resolve({ name: file.name, type: file.type, dataUrl });
                    };
                    reader.onerror = (e) => {
                        console.error("Error reading file:", file.name, e);
                        reject(new Error(`Error reading file: ${file.name}`));
                    };
                    reader.readAsDataURL(file);
                });
            });

            Promise.all(filePromises)
                .then(newFiles => {
                    // Append new files to existing ones (or replace, depending on desired behavior)
                    // For now, let's append, preventing duplicates by name
                    setAttachedFiles(prevFiles => {
                        const updatedFiles = [...prevFiles];
                        newFiles.forEach(newFile => {
                            if (!prevFiles.some(f => f.name === newFile.name)) {
                                updatedFiles.push(newFile);
                            } else {
                                console.warn(`File "${newFile.name}" already attached. Skipping.`);
                            }
                        });
                        return updatedFiles;
                    });
                    setStatusMessage(''); // Clear errors on success
                })
                .catch(error => {
                    setStatusMessage(error.message);
                });
        }
        // Reset file input value
        if (event.target) {
            event.target.value = '';
        }
    };

    // Update remove function to handle index
    const handleRemoveFile = (indexToRemove: number) => {
        setAttachedFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
        setStatusMessage('');
    };
    // --- End File Handling ---


    return (
        <>
            {/* Main container with border */}
            <div className="flex flex-col border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                {/* File Bubble Area (Above Textarea) - Map over array */}
                {attachedFiles.length > 0 && (
                    <div className="px-2 pt-2 pb-1 flex flex-wrap gap-2"> {/* Use flex-wrap and gap */}
                        {/* Map over attachedFiles */}
                        {attachedFiles.map((file, index) => (
                            <div key={index} className="inline-flex items-center bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-sm font-medium px-3 py-1 rounded-full">
                                <Paperclip className="w-4 h-4 mr-1.5" />
                                <span className="truncate max-w-xs">{file.name}</span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveFile(index)} // Pass index to remove function
                                    className="ml-2 -mr-1 p-0.5 rounded-full text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-700 focus:outline-none"
                                    title="Remove file"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {/* Input Row */}
                <div className="flex items-end p-2">
                    {/* Hidden File Input - Add 'multiple' attribute */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        multiple // Allow multiple file selection
                        accept="text/*,.json,.md,.csv,.py,.js,.ts,.html,.css,application/json,application/csv,application/xml,application/javascript,application/pdf,image/*"
                    />
                    {/* Attach File Button */}
                    <button
                        type="button"
                        className={`mr-2 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50`}
                        onClick={handleAttachClick}
                        disabled={isRecording}
                        title="Attach Files" // Updated title
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                    <TextareaAutosize
                        minRows={1}
                        maxRows={6}
                        placeholder="Type message or attach files..." // Updated placeholder
                        className="flex-grow p-2 bg-transparent text-gray-900 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none resize-none overflow-y-auto"
                        value={value}
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                    />
                    {/* Microphone Button */}
                    <button
                        type="button"
                        className={`ml-2 p-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${isRecording
                            ? 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            } ${!isSpeechApiAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                            onClick={onStop}
                            title="Stop Generation"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                            </svg>
                        </button>
                    ) : (
                        // Send Button - Update disabled logic
                        <button
                            type="button"
                            className="ml-2 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onClick={handleSendClick}
                            disabled={(!value.trim() && attachedFiles.length === 0) || isRecording} // Disable if recording or if input empty AND no files attached
                            title="Send"
                        >
                            <SendHorizontal className="w-5 h-5" />
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