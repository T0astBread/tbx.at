<script frontmatter>
title = "To Lens or not to Lens?"
layout = "post"
abstract = `For my first steps with Haskell I've evaluated options for handling records, including the optics libraries "lens" and "optics-core".`
lastModified = new Date(Date.parse("2022-10-16"))
</script>

{{#> box}}

**This is not seasoned Haskell advice!** I'm still very new to this language and these are my first impressions with records and optics.

If you've landed here because you're thinking about using anything optics-related: Keep reading, maybe you'll discover something you didn't know but do your own research on top!

{{/box}}

Haskell is a pretty cool programming language but one thing that's frequently criticised is the syntax for accessing record fields and creating updated copies of a record value. Records are normally defined like this:

```haskell
data Node = Node
  { nodeID :: NodeID,
    nodePosition :: V2 Double,
    nodeSize :: V2 Double
  }
```

The above snippet creates a data type called `Node` with a record constructor. Accessing record fields works like this:

```haskell
nodeID myNode
```

Each record field gets a function that takes a value of the record type and returns the value of that specific field. This is a convenient system because field accessors can be used like any other function. However, it bears one major downside: Field names are not scoped to the record type. That means fields live in the same namespace as anything else in the current module, including fields of other records.

```haskell
data Node = Node
  { id :: NodeID, -- Error: clashes with "id" of "Edge"
    position :: V2 Double,
    size :: V2 Double
  }

data Edge = Edge
  { id :: EdgeID, -- Error: clashes with "id" of "Node"
    start :: NodeID,
    end :: NodeID
  }
```

Another aspect of records are updates. Records (like any other value in Haskell) are immutable, so you can't just write something like

```
myNode.id = NodeID "1"
```

…and modify `myNode`. Instead, Haskell lets you create an updated copy of a record value with a special syntactical construct. If you wanted to get a value that's equivalent to `myNode` but with a different value for `nodeID`, you would use the following expression:

```haskell
myNode {nodeID = NodeID "1"}
```

For flat records, that's perfectly fine but once you start nesting records, it can get a bit hairy.

```haskell
myNode {nodePosition = (nodePosition myNode) {v2X = 20}}
```

And that's only one level of nesting.

## Optics

Smart people have invented something called "lenses", which are part of a more general family of operators called "optics". Lenses, through some [dark magic](https://www.fpcomplete.com/haskell/tutorial/lens/), encapsulate the aspect of selecting a field (including nested fields) and separate it from updating a record or getting a value. That means lenses don't care what they're being used for, can be composed freely and the composite lens can then be used to act on nested fields.

A popular optics library for Haskell is `lens`, which looks like this when defining a record:

```haskell
data Node = Node
  { _nodeID :: NodeID,
    _nodePosition :: V2 Double,
    _nodeSize :: V2 Double
  }

makeLenses ''Node
```

Fields prefixed with an underscore have lenses generated for them. The generated lenses can then be used to access record fields…

```haskell
myNode ^. nodeID
```

…and create updated copies.

```haskell
myNode & nodeID .~ NodeID "1"
```

Nested usage, as mentioned above, is done by composition.

```haskell
myNode & nodePosition . v2X .~ 20
```

{{#> box}}

`&` is just a helper function to reverse the order of function application.

```haskell
myNode & nodeID .~ NodeID "1"
```

…is equivalent to

```haskell
(nodeID .~ NodeID "1") myNode
```

{{/box}}

This solves the awkward update situation but it still has the downside of name clashes, since every lens gets its own function. But `lens` has a solution for that as well: `makeFields`.

`makeFields` is an alternative to `makeLenses` that generates a typeclass-based lens instead (don't ask me how it works) which can be used on any record with a field of the same name. That allows us to have multiple record types with similarly named fields.

```haskell
data Node = Node
  { _nodeID :: String,
    _nodePosition :: V2 Double,
    _nodeSize :: V2 Double
  }

makeFields ''Node

data Edge = Edge
  { _edgeID :: String,
    _edgeStart :: NodeID,
    _edgeEnd :: NodeID
  }

makeFields ''Edge
```

The same name can then be used to refer to different record fields:

```haskell
n ^. iD <> e ^. iD
```

{{#> box}}

The auto-generated camelcase is awkward for some fields but that can be customized. Have a look at [`FieldNamer`s](https://hackage.haskell.org/package/lens-5.2/docs/Control-Lens-TH.html#g:14).

{{/box}}

But even `makeFields` is not without downsides. In order to use `makeFields`-based lenses in other modules, you have to export the generated typeclasses, which is kind of annoying:

```haskell
module Foo
  ( Node (..),
    HasID (..),
    HasPosition (..),
    HasSize (..),
  )
where

data Node = Node
  { _nodeID :: NodeID,
    _nodePosition :: V2 Double,
    _nodeSize :: V2 Double
  }

makeFields ''Node
```

And statically linked copies of HLS, the Haskell Language Server, don't provide auto completion for Template Haskell-generated code. For example, the HLS binary shipped in the Nix package index (which is pretty popular among Haskellers) is affected by this.

## GHC features

GHC itself also has a few flags that change the behavior of records. A [simple suggestion by Reddit user "arybczak"](https://old.reddit.com/r/haskell/comments/x4ot3e/record_update_in_2022/imx54at/) uses `DuplicateRecordFields` and `OverloadedRecordDot`.

- `DuplicateRecordFields` permits multiple record types to have fields of the same name, requiring the user to resolve ambiguity.
- `OverloadedRecordDot` enables an alternative syntax for accessing record fields that resembles similar syntactical constructs in other languages.

`OverloadedRecordDot` would not strictly be required if you just want multiple record types with similar fields but it helps with avoiding ambiguity. Consider the following example:

```haskell
{-# LANGUAGE DuplicateRecordFields #-}

data Node = Node
  { id :: String
  }

data Edge = Edge
  { id :: String
  }

foo :: Node -> Edge -> String
foo n e = n & id <> e & id
```

In `foo`, the compiler would complain about `id` being ambiguous between the field selector for `Node`, the field selector for `Edge` and the `id` function in `Prelude`. `OverloadedRecordDot` resolves that ambiguity:

```haskell
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedRecordDot #-}

data Node = Node
  { id :: String
  }

data Edge = Edge
  { id :: String
  }

foo :: Node -> Edge -> String
foo n e = n.id <> e.id
```

`OverloadedRecordDot` does not fundamentally change updates though, so you still have long-winded nested updates.

```haskell
myNode {position = myNode.position {v2X = 20}}
```

Another GHC feature, `OverloadedRecordUpdate`, will supposedly bring a similar syntax to record updates in the future but as it stands, it's still experimental and not super comfortable to use.

Also, for what it's worth, I wasn't able to get HLS running with GHC 9.2, which is required for `OverloadedRecordDot`. I'm not sure why but the version from Nixpkgs only supports GHC 9.0.2 (which is currently the default for the `ghc` package in Nix), regardless of how I've configured it. (And that does bother me a bit but I didn't want to spend more time figuring this out at the moment.)

## Generics-based optics

The Reddit comment linked above also suggests another library called `optics-core` (which is part of a set of libraries called "optics") in conjunction with `GHC.Generic`. That results in something similar to `makeFields` with the `lens` library above but…

- without having to export and import any generated code and…
- without using Template Haskell. (So it always works in HLS.)

The above example would look like this with `optics-core`:

```haskell
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE OverloadedLabels #-}

import GHC.Generics (Generic)
import Optics.Core ((^.))

data Node = Node
  { id :: String
  } deriving (Generic)

data Edge = Edge
  { id :: String
  } deriving (Generic)

foo :: Node -> Edge -> String
foo n e = n ^. #id <> e ^. #id
```

Nested updates stay manageable as well.

```haskell
myNode & #position % #x .~ 20
```

This is almost ideal but it still has one major downside: If you can only use pre-9.2 GHC, you can't disable generation of field accessor functions (via `NoFieldSelectors`). `DuplicateRecordFields` allows you to have multiple record fields of the same name and lenses generally avoid ambiguity but the generated accessor functions can still create ambiguity with other unrelated functions or names (like `where` bindings). For example, the above `id` fields could clash with `id` in `Prelude`.

## So what did I end up choosing?

For the time being, I think I'll stick with vanilla records (without any GHC flags) and all the awkwardness attached to them. It's a low-magic solution and it requires no extra tooling effort. Also, the programs I'll be writing now aren't huge and I don't expect to have many nested records.

If I ever get GHC 9.2 working though, I might switch to `optics-core`. I'm not sure if it noticeably slows down compilation (because generics are said to be slower than Template Haskell) but I'll just have to try it out. Additionally, if I get Template Haskell working I would also evaluate `optics-th`, the Template Haskell version of `optics`.

{{#> ps}}

The [discussion](https://old.reddit.com/r/haskell/comments/y4ylww/to_lens_or_not_to_lens_trying_out_alternatives/) for this article on Reddit also contains some useful input.

{{/ps}}
