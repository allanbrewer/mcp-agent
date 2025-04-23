import React, { useState, useEffect, useRef, useCallback } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Mic, MicOff, SendHorizontal } from 'lucide-react'; // Import icons

// Define the interface for the SpeechRecognition API (including vendor prefixes)
interface CustomWindow extends Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
}
declare const window: CustomWindow;

interface ChatInputProps {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onSend: (text: string) => void;
    status: 'error' | 'submitted' | 'streaming' | 'ready'; // Add status prop
    onStop: () => void; // Add onStop prop
}

const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSend, status, onStop }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isSpeechApiAvailable, setIsSpeechApiAvailable] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const recognitionRef = useRef<SpeechRecognition | null>(null);
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

    // Remove the internal handleInputChange wrapper
    // const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    //     onChange(event.target.value);
    // };

    const handleSendClick = () => {
        if (value.trim()) {
            onSend(value);
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

        // Update status message to show listening state (optional)
        // setStatusMessage(`Listening... ${interimTranscript}`);

    }, [onChange]); // Remove 'value' dependency, rely on ref

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


    return (
        // Wrap input and status in a fragment or div
        <>
            <div className="flex items-end p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                <TextareaAutosize
                    minRows={1}
                    maxRows={6}
                    placeholder="Type or use microphone..." // Updated placeholder
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
                        disabled={!value.trim() || isRecording} // Disable send while recording or if input empty
                        title="Send"
                    >
                        <SendHorizontal className="w-5 h-5" /> {/* Using Lucide icon */}
                    </button>
                )}
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