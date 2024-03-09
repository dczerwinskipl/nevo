namespace NEvo.Core;

public interface IMiddleware<TInput, TResult>
{
    Task<TResult> ExecuteAsync(TInput input, CancellationToken cancellationToken, Func<Task<TResult>> next);
}
