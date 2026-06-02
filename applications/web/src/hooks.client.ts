import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, event, status, message }) => {
  console.error('[client error]', { status, message, url: event.url.pathname, error });

  return {
    message: message ?? 'An unexpected error occurred',
    code: 'CLIENT_ERROR',
  };
};
