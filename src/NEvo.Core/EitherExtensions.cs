using static LanguageExt.Prelude;

namespace LanguageExt;

public static class EitherExtensions
{
    public static Either<TLeft, TRight> Do<TLeft, TRight>(
        this Either<TLeft, TRight> either,
        Action<TRight> Right,
        Action<TLeft> Left
    )
    {
        either.Match(Right, Left);
        return either;
    }

    /// <summary>
    /// Collapses the common "found or not found" repository-read shape in one step:
    /// <c>Some</c> maps to the result, <c>None</c> becomes a <c>Left</c> via <paramref name="None"/>
    /// (an existing <c>Left</c> passes through unchanged).
    /// </summary>
    public static EitherAsync<TLeft, TResult> MapAsync<TLeft, TRight, TResult>(
        this EitherAsync<TLeft, Option<TRight>> self,
        Func<TRight, TResult> Some,
        Func<TLeft> None
    ) => self.Bind(option => option.Match(
        Some: value => RightAsync<TLeft, TResult>(Some(value)),
        None: () => LeftAsync<TLeft, TResult>(None())
    ));
}
