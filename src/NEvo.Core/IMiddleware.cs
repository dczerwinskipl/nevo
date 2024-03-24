namespace NEvo.Core;

public interface IMiddleware<TInput, TResult>
{
    Task<TResult> ExecuteAsync(TInput input, Func<Task<TResult>> next, CancellationToken cancellationToken);
}
