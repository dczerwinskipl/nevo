namespace NEvo.Core;

public class MiddlewareHandler<TInput, TResult, TMiddleware>(IEnumerable<MiddlewareConfig<TInput, TResult, TMiddleware>>? middlewareConfigs) : IMiddlewareHandler<TInput, TResult> where TMiddleware : IMiddleware<TInput, TResult>
{
    private readonly IEnumerable<MiddlewareConfig<TInput, TResult, TMiddleware>> _middlewareConfigs = middlewareConfigs?.Reverse() ?? [];

    public MiddlewareHandler(IEnumerable<TMiddleware> middlewares)
       : this(middlewares.Select(middleware => new MiddlewareConfig<TInput, TResult, TMiddleware>(middleware)))
    {
    }

    public async Task<TResult> ExecuteAsync(Func<TInput, CancellationToken, Task<TResult>> baseDelegate, TInput input, CancellationToken cancellationToken)
    {
        var execute = baseDelegate;

        foreach (var middleware in _middlewareConfigs.Where(config => ShouldApply(config, input)).Select(config => config.Middleware))
        {
            var currentMiddleware = middleware;
            var next = execute;
            execute = async (currentInput, token) => await currentMiddleware.ExecuteAsync(currentInput, () => next(currentInput, token), token);
        }

        return await execute(input, cancellationToken);
    }

    private static bool ShouldApply(MiddlewareConfig<TInput, TResult, TMiddleware> middleware, TInput input) => middleware.ShouldApply?.Invoke(input) ?? true;
}


// TODO: better naming, maybe just options or something like that?
public class MiddlewareConfig<TInput, TResult, TMiddleware>(TMiddleware middleware, Func<TInput, bool>? shouldApply = null) where TMiddleware : IMiddleware<TInput, TResult>
{
    public TMiddleware Middleware { get; } = middleware;
    public Func<TInput, bool>? ShouldApply { get; } = shouldApply;
}