namespace NEvo.Core;

public class MiddlewareHandler<TInput, TResult>(IEnumerable<MiddlewareConfig<TInput, TResult>>? middlewareConfigs) : IMiddlewareHandler<TInput, TResult>
{
    private readonly IEnumerable<MiddlewareConfig<TInput, TResult>> _middlewareConfigs = middlewareConfigs?.Reverse() ?? [];

    public MiddlewareHandler(IEnumerable<IMiddleware<TInput, TResult>> middlewares)
       : this(middlewares.Select(middleware => new MiddlewareConfig<TInput, TResult>(middleware)))
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

    private static bool ShouldApply(MiddlewareConfig<TInput, TResult> middleware, TInput input) => middleware.ShouldApply?.Invoke(input) ?? true;
}


// TODO: better naming, maybe just options or something like that?
public class MiddlewareConfig<TInput, TResult>(IMiddleware<TInput, TResult> middleware, Func<TInput, bool>? shouldApply = null)
{
    public IMiddleware<TInput, TResult> Middleware { get; } = middleware;
    public Func<TInput, bool>? ShouldApply { get; } = shouldApply;
}