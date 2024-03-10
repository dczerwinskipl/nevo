namespace NEvo.Core;

public class MiddlewareHandler<TInput, TResult, TMiddleware> : IMiddlewareHandler<TInput, TResult> where TMiddleware : IMiddleware<TInput, TResult>
{
    private readonly IEnumerable<MiddlewareConfig<TInput, TResult, TMiddleware>> _middlewareConfigs;

    public MiddlewareHandler(IEnumerable<TMiddleware> middlewares)
       : this(middlewares.Select(middleware => new MiddlewareConfig<TInput, TResult, TMiddleware>(middleware)))
    {
    }

    public MiddlewareHandler(IEnumerable<MiddlewareConfig<TInput, TResult, TMiddleware>>? middlewareConfigs)
    {
        _middlewareConfigs = middlewareConfigs?.Reverse() ?? Enumerable.Empty<MiddlewareConfig<TInput, TResult, TMiddleware>>();
    }

    public async Task<TResult> ExecuteAsync(Func<TInput, CancellationToken, Task<TResult>> baseDelegate, TInput input, CancellationToken cancellationToken)
    {
        var execute = baseDelegate;

        foreach (var middlewareConfig in _middlewareConfigs.Where(middleware => ShouldApply(middleware, input)))
        {
            var currentMiddleware = middlewareConfig.Middleware;
            var next = execute;
            execute = async (currentInput, token) => await currentMiddleware.ExecuteAsync(currentInput, token, () => next(currentInput, token));
        }

        return await execute(input, cancellationToken);
    }

    private bool ShouldApply(MiddlewareConfig<TInput, TResult, TMiddleware> middleware, TInput input) => middleware.ShouldApply?.Invoke(input) ?? true;
}


// TODO: better naming, maybe just options or something like that?
public class MiddlewareConfig<TInput, TResult, TMiddleware> where TMiddleware : IMiddleware<TInput, TResult>
{
    public TMiddleware Middleware { get; }
    public Func<TInput, bool>? ShouldApply { get; }

    public MiddlewareConfig(TMiddleware middleware, Func<TInput, bool>? shouldApply = null)
    {
        Middleware = middleware;
        ShouldApply = shouldApply;
    }
}