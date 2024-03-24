namespace NEvo.Core;

public interface IMiddlewareHandler<TInput, TResult>
{
    Task<TResult> ExecuteAsync(Func<TInput, CancellationToken, Task<TResult>> baseDelegate, TInput input, CancellationToken cancellationToken);
}