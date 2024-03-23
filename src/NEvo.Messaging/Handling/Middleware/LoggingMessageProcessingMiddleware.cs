using System.Diagnostics;
using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public class LoggingMessageProcessingMiddleware : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    private readonly ILogger<LoggingMessageProcessingMiddleware> _logger;

    public LoggingMessageProcessingMiddleware(ILogger<LoggingMessageProcessingMiddleware> logger)
    {
        _logger = Check.Null(logger);
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        _logger.LogInformation("Processing message #{MessageId} started", message.Id);

        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => _logger.LogInformation("Processing message #{MessageId} finished with success in {Time} ms", message.Id, stopwatch.ElapsedMilliseconds),
            exc => _logger.LogError(exc, "Processing message #{MessageId} finished with exception in {Time} ms", message.Id, stopwatch.ElapsedMilliseconds)
        );

        return result;
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler handler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        _logger.LogInformation("Handler {Handler} for message #{MessageId} started", handler.HandlerDescription.ToString(), message.Id);

        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => _logger.LogInformation("Handler {Handler} for message #{MessageId} finished with success in {Time} ms", handler.HandlerDescription.ToString(), message.Id, stopwatch.ElapsedMilliseconds),
            exc => _logger.LogError(exc, "Handler {Handler} for message #{MessageId} finished with exception in {Time} ms", handler.HandlerDescription.ToString(), message.Id, stopwatch.ElapsedMilliseconds)
        );

        return result;
    }
}